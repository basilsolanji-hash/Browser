#!/usr/bin/env python3
"""Local/device acceptance for outgoing app links; only ACTION_VIEW of a fake number."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import socket
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


class Blocked(RuntimeError):
    pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', default=os.environ.get('PKG', 'ru.multibrowser.test'))
    parser.add_argument('--out', default=os.environ.get('OUT', 'results-external-apps'))
    parser.add_argument('--serial', default=os.environ.get('ANDROID_SERIAL'))
    parser.add_argument('--timeout', type=int, default=60)
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.]+', args.package):
        parser.error('Invalid package')
    if args.package != 'ru.multibrowser.test' and os.environ.get('OS_TEST_ALLOW_RELEASE') != '1':
        parser.error('Use the separate .test APK; release-device testing requires OS_TEST_ALLOW_RELEASE=1')
    if not 10 <= args.timeout <= 180:
        parser.error('Timeout must be between 10 and 180 seconds')
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    root = Path(__file__).resolve().parents[2]
    run = secrets.token_hex(4)
    records = []
    fixture = None
    fixture_log = None
    reverse_created = False
    adb_prefix = ['adb'] + (['-s', args.serial] if args.serial else [])

    def report(name, details=None):
        item = {'check': name, 'status': 'PASS'}
        if details is not None:
            item['details'] = details
        records.append(item)
        print('PASS ' + name, flush=True)

    def adb(*command, check=True, timeout=30):
        result = subprocess.run(adb_prefix + list(command), capture_output=True, text=True, timeout=timeout)
        if check and result.returncode:
            raise Blocked('ADB operation failed: ' + ' '.join(command[:4]))
        return result.stdout.replace('\r', '')

    def wait(predicate, description, timeout=None):
        deadline = time.monotonic() + (timeout if timeout is not None else args.timeout)
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(.3)
        raise AssertionError('Timed out: ' + description)

    def snapshot():
        try:
            with urllib.request.urlopen('http://127.0.0.1:8768/snapshot', timeout=5) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError):
            return {}

    def current(case):
        return snapshot().get(case, {})

    def event(case, name):
        return wait(lambda: current(case).get('events', {}).get(name, 0), name)

    def ui():
        result = adb('shell', 'uiautomator', 'dump', '/sdcard/os-external-ui.xml', check=False)
        if 'ERROR' in result:
            return None
        data = adb('exec-out', 'cat', '/sdcard/os-external-ui.xml', check=False)
        try:
            return ET.fromstring(data)
        except ET.ParseError:
            return None

    def tap_node(predicate, description):
        def find():
            tree = ui()
            if tree is None:
                return None
            for node in tree.iter('node'):
                if predicate(node):
                    coords = re.findall(r'\d+', node.get('bounds', ''))
                    if len(coords) == 4:
                        x1, y1, x2, y2 = map(int, coords)
                        if x2 > x1 and y2 > y1:
                            return (str((x1 + x2) // 2), str((y1 + y2) // 2))
            return None
        try:
            point = wait(find, description)
        except AssertionError as error:
            raise Blocked('UI automation cannot locate: ' + description) from error
        adb('shell', 'input', 'tap', *point)

    def web_link(text):
        tap_node(lambda node: text in (node.get('text'), node.get('content-desc')), text)

    def foreground():
        data = adb('shell', 'dumpsys', 'activity', 'activities')
        for label in ['topResumedActivity', 'mResumedActivity']:
            for line in data.splitlines():
                if label in line:
                    match = re.search(r'([A-Za-z0-9_.]+/[A-Za-z0-9_.$]+)', line)
                    if match:
                        return match.group(1)
        return None

    def is_browser():
        component = foreground()
        return component and component.startswith(args.package + '/') and component.endswith('BrowserActivity')

    text = '\n'.join(path.read_text() for path in (root / 'app/src/main/java/ru/multibrowser').glob('Tr*.kt'))
    match = re.search(r'"open_app" to listOf\((.*?)\),', text, re.S)
    prompt_titles = ({json.loads(value) for value in re.findall(r'"(?:[^"\\]|\\.)*"', match.group(1))}
                     if match else {'Open in app', 'Открыть в приложении'})

    def app_prompt():
        tree = ui()
        if tree is None:
            return False
        return any(node.get('text') in prompt_titles and node.get('resource-id', '').endswith('/alertTitle')
                   for node in tree.iter('node'))

    def prompt_button(number):
        wait(app_prompt, 'app handoff confirmation')
        tap_node(lambda node: node.get('resource-id', '').endswith('/button' + str(number)), 'confirmation button')

    def no_handoff(expected_component=None):
        for _ in range(3):
            assert not app_prompt(), 'A background/subframe request showed an app confirmation'
            if expected_component is None:
                assert is_browser(), 'Browser unexpectedly lost foreground'
            else:
                assert foreground() == expected_component, 'Background request changed foreground app'
            time.sleep(.4)

    def read_pref(name):
        result = subprocess.run(adb_prefix + ['exec-out', 'run-as', args.package, 'cat', 'shared_prefs/' + name + '.xml'],
                                capture_output=True, text=True, timeout=30)
        if result.returncode:
            if 'no such file' in (result.stdout + result.stderr).lower():
                return None
            raise Blocked('Cannot inspect test-app preferences; run-as requires the separate debug APK')
        return result.stdout

    def tab_signature():
        def read():
            content = read_pref('profiles')
            if not content:
                return None
            try:
                values = {node.get('name'): node.text for node in ET.fromstring(content).findall('string')}
                selected = values.get('last_pin_14') or values.get('pin')
                if not selected:
                    return None
                tabs = read_pref('tabs')
                count = 0
                if tabs:
                    raw = next((node.text for node in ET.fromstring(tabs).findall('string') if node.get('name') == 'list_14'), '[]')
                    count = len(json.loads(raw))
                return selected, count
            except (ET.ParseError, json.JSONDecodeError):
                return None
        return wait(read, 'persisted selected test tab')

    def screenshot(name):
        # Screenshots are taken only in the test browser, never in the external dialer/launcher.
        assert is_browser(), 'Refusing screenshot outside the test browser'
        result = subprocess.run(adb_prefix + ['exec-out', 'screencap', '-p'], capture_output=True, timeout=30, check=True)
        (out / (name + '.png')).write_bytes(result.stdout)

    def start(case, mode='normal', private=False):
        url = 'http://localhost:8768/page?' + urllib.parse.urlencode({'case': case, 'mode': mode})
        command = ['shell', 'am', 'start', '-n', args.package + '/ru.multibrowser.BrowserActivity',
                   '--ei', 'profile', '14', '--es', 'site', 'start', '--es', 'url', url]
        if private:
            command += ['--es', 'action', 'incognito']
        adb(*command)
        event(case, 'loaded')
        wait(is_browser, 'browser foreground')

    def resume():
        adb('shell', 'am', 'start', '-n', args.package + '/ru.multibrowser.BrowserActivity', '--ei', 'profile', '14', '--es', 'site', 'start')
        wait(is_browser, 'return to browser')

    try:
        if not shutil.which('adb'):
            raise Blocked('adb is not installed')
        if adb('get-state', check=False).strip() != 'device':
            raise Blocked('No ready Android device/emulator; offline is not an application failure')
        if not adb('shell', 'pm', 'path', args.package, check=False).strip():
            raise Blocked('The separate test APK is not installed')
        if adb('shell', 'pm', 'path', 'ru.multibrowser.acceptance.missing', check=False).strip():
            raise Blocked('The intentionally missing target package is installed')
        with socket.socket() as probe:
            probe.settimeout(.5)
            if probe.connect_ex(('127.0.0.1', 8768)) == 0:
                raise Blocked('Loopback fixture port 8768 is already in use')
        fixture_log = (out / 'fixture.log').open('wb')
        fixture = subprocess.Popen([sys.executable, str(root / '.github/scripts/fixtures/external-apps.py')], stdout=fixture_log, stderr=subprocess.STDOUT)
        def fixture_ready():
            if fixture.poll() is not None:
                raise Blocked('Loopback fixture exited; inspect fixture.log')
            try:
                with urllib.request.urlopen('http://127.0.0.1:8768/snapshot', timeout=2) as response:
                    return response.status == 200
            except urllib.error.URLError:
                return False
        wait(fixture_ready, 'loopback fixture readiness')
        adb('reverse', 'tcp:8768', 'tcp:8768')
        reverse_created = True

        case = 'normal-' + run
        start(case)
        web_link('Open dialer')
        wait(app_prompt, 'explicit handoff prompt')
        screenshot('01-open-app-confirmation')
        prompt_button(2)
        wait(lambda: not app_prompt(), 'cancel closes prompt')
        no_handoff()
        report('Cancel keeps the page in the browser')

        resolved = adb('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.intent.action.VIEW',
                       '-c', 'android.intent.category.BROWSABLE', '-d', 'tel:5551234', check=False)
        targets = re.findall(r'([A-Za-z0-9_.]+/[A-Za-z0-9_.$]+)', resolved)
        if not targets or targets[-1].startswith('android/'):
            raise Blocked('Choose a default dialer for tel: links before automated real-app acceptance')
        target_package = targets[-1].split('/')[0]
        web_link('Open dialer')
        prompt_button(1)
        def external_foreground():
            component = foreground()
            return component if component and component.startswith(target_package + '/') else None
        component = wait(external_foreground, 'real tel ACTION_VIEW handler')
        report('User-confirmed link opens the real external ACTION_VIEW handler; no call action is sent', {'component': component})
        # Do not touch the dialer's call button and do not capture any private call history.
        resume()

        case = 'fallback-' + run
        start(case)
        before_tab = tab_signature()
        web_link('Missing app fallback')
        prompt_button(2)
        wait(lambda: not app_prompt(), 'cancel fallback prompt')
        no_handoff()
        assert current(case).get('fallbacks', 0) == 0, 'Cancel loaded a fallback'
        report('Cancel does not load an absent-app fallback')
        web_link('Missing app fallback')
        prompt_button(1)
        wait(lambda: current(case).get('fallbacks', 0) == 1, 'same-browser fallback')
        assert is_browser(), 'Fallback left the browser'
        assert tab_signature() == before_tab, 'Fallback created or switched an ordinary tab'
        screenshot('02-missing-app-web-fallback')
        report('Missing intent target opens its fallback once in the same browser and tab')

        case = 'auto-' + run
        start(case, mode='auto')
        event(case, 'auto_attempt')
        no_handoff()
        report('Automatic app request without user gesture is blocked')

        case = 'frame-' + run
        start(case, mode='frame')
        web_link('Frame dialer')
        event(case, 'frame_click')
        no_handoff()
        report('Self-targeted subframe navigation cannot launch another app')

        case = 'background-' + run
        start(case, mode='background')
        adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
        def launcher_foreground():
            component = foreground()
            return component if component and not component.startswith(args.package + '/') else None
        home = wait(launcher_foreground, 'launcher foreground')
        if current(case).get('events', {}).get('background_attempt', 0):
            raise Blocked('Background timer elapsed before the launcher precondition was established')
        event(case, 'background_attempt')
        no_handoff(home)
        report('A background page cannot launch an app or show its confirmation')
        resume()

        case = 'private-' + run
        start(case, mode='incognito', private=True)
        web_link('Missing app fallback')
        prompt_button(1)
        wait(lambda: current(case).get('fallbacks', 0) == 1, 'incognito fallback')
        assert is_browser(), 'Incognito fallback left the browser'
        for name in ['profiles', 'tabs', 'history']:
            contents = read_pref(name)
            assert case not in (contents or ''), 'Private fallback URL was persisted to ' + name
        screenshot('03-incognito-fallback')
        report('Incognito fallback stays in the browser and does not persist its URL')
        (out / 'fixture-state.json').write_text(json.dumps(snapshot(), indent=2))
        return 0
    except Blocked as error:
        records.append({'status': 'BLOCKED', 'reason': str(error)})
        print('BLOCKED ' + str(error), flush=True)
        return 2
    except (subprocess.TimeoutExpired, urllib.error.URLError) as error:
        records.append({'status': 'BLOCKED', 'reason': 'Device/helper transport unavailable: ' + type(error).__name__})
        print('BLOCKED device/helper transport unavailable', flush=True)
        return 2
    except AssertionError as error:
        records.append({'status': 'FAIL', 'reason': str(error)})
        print('FAIL ' + str(error), flush=True)
        return 1
    finally:
        if fixture is not None and fixture.poll() is None:
            (out / 'fixture-state.json').write_text(json.dumps(snapshot(), indent=2))
            fixture.terminate()
            try:
                fixture.wait(timeout=5)
            except subprocess.TimeoutExpired:
                fixture.kill()
        if reverse_created:
            adb('reverse', '--remove', 'tcp:8768', check=False)
        if fixture_log is not None:
            fixture_log.close()
        (out / 'checks.json').write_text(json.dumps(records, ensure_ascii=False, indent=2))
        (out / 'checks.txt').write_text('\n'.join(item['status'] + ' ' + item.get('check', item.get('reason', '')) for item in records) + '\n')


if __name__ == '__main__':
    sys.exit(main())
