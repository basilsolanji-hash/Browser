; Регистрация Оси как браузера для Windows «Приложения по умолчанию» (ProgId и возможности приложения).
; Стать браузером по умолчанию программно нельзя — выбор делает пользователь в настройках Windows.
!macro customInstall
  WriteRegStr SHCTX "Software\Classes\OsBrowserURL" "" "Os Browser URL"
  WriteRegStr SHCTX "Software\Classes\OsBrowserURL" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\OsBrowserURL\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\OsBrowserURL\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser" "" "Os Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\Capabilities" "ApplicationName" "Os Browser"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\Capabilities" "ApplicationDescription" "Business browser with isolated profiles and tracking protection"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\Capabilities" "ApplicationIcon" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\Capabilities\URLAssociations" "http" "OsBrowserURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\OsBrowser\Capabilities\URLAssociations" "https" "OsBrowserURL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Os Browser" "Software\Clients\StartMenuInternet\OsBrowser\Capabilities"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\OsBrowserURL"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\OsBrowser"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Os Browser"
!macroend
