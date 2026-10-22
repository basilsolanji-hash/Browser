package ru.multibrowser

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.Gravity
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

/** Главный экран: сетка из 15 профилей. Нажатие — открыть, долгое нажатие — переименовать. */
class MainActivity : AppCompatActivity() {

    private lateinit var grid: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        grid = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(12))
        }
        setContentView(ScrollView(this).apply { addView(grid) })
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    private fun render() {
        grid.removeAllViews()
        grid.addView(TextView(this).apply {
            text = "Профили"
            textSize = 24f
            setPadding(dp(4), dp(8), dp(4), dp(16))
        })
        Profiles.all(this).chunked(3).forEach { row ->
            val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            row.forEach { line.addView(tile(it)) }
            grid.addView(line)
        }
        grid.addView(TextView(this).apply {
            text = "● — профиль открыт в памяти. Долгое нажатие — переименовать."
            textSize = 13f
            alpha = 0.6f
            setPadding(dp(4), dp(16), dp(4), dp(4))
        })
    }

    private fun tile(p: Profile) = TextView(this).apply {
        text = if (Gecko.isActive(p.id)) "● ${p.name}" else p.name
        textSize = 15f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setPadding(dp(6), dp(6), dp(6), dp(6))
        background = GradientDrawable().apply {
            setColor(p.color)
            cornerRadius = dp(14).toFloat()
        }
        layoutParams = LinearLayout.LayoutParams(0, dp(96), 1f).apply {
            setMargins(dp(5), dp(5), dp(5), dp(5))
        }
        setOnClickListener {
            startActivity(Intent(this@MainActivity, BrowserActivity::class.java)
                .putExtra(BrowserActivity.EXTRA_PROFILE, p.id))
        }
        setOnLongClickListener { renameDialog(p); true }
    }

    private fun renameDialog(p: Profile) {
        val input = EditText(this).apply { setText(p.name); setSingleLine() }
        AlertDialog.Builder(this)
            .setTitle("Название профиля")
            .setView(input)
            .setPositiveButton("Сохранить") { _, _ ->
                if (input.text.isNotBlank()) Profiles.rename(this, p.id, input.text.toString())
                render()
            }
            .setNegativeButton("Отмена", null)
            .show()
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
