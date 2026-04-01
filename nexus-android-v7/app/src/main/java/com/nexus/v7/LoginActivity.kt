package com.nexus.v7

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.LinearGradient
import android.graphics.Shader
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.nexus.v7.api.NexusApiClient
import kotlinx.coroutines.*

class LoginActivity : AppCompatActivity() {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var prefs: SharedPreferences

    private lateinit var serverUrlInput: EditText
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var loginButton: Button
    private lateinit var statusText: TextView

    private val qrScanLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            val url = result.data?.getStringExtra(QRScanActivity.EXTRA_SERVER_URL)
            val pairingToken = result.data?.getStringExtra(QRScanActivity.EXTRA_PAIRING_TOKEN)
            if (!url.isNullOrEmpty()) {
                serverUrlInput.setText(url)
                if (pairingToken != null) {
                    // QR code included a pairing token — go straight to main
                    prefs.edit()
                        .putString("server_url", url)
                        .putString("auth_token", pairingToken)
                        .apply()
                    goToMain()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("nexus_v7", Context.MODE_PRIVATE)

        // Auto-login: if we have a saved token, validate and proceed
        val savedUrl = prefs.getString("server_url", null)
        val savedToken = prefs.getString("auth_token", null)
        if (savedUrl != null && savedToken != null) {
            tryAutoLogin(savedUrl, savedToken)
            return
        }

        buildUI()
    }

    private fun tryAutoLogin(url: String, token: String) {
        // Show a quick loading screen
        val loading = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xFF080A12.toInt())
            addView(ProgressBar(this@LoginActivity).apply {
                isIndeterminate = true
            })
            addView(TextView(this@LoginActivity).apply {
                text = "Signing in..."; textSize = 14f; setTextColor(0xFF8B8B9E.toInt())
                gravity = Gravity.CENTER; setPadding(0, dp(16), 0, 0)
            })
        }
        setContentView(loading)

        scope.launch {
            val client = NexusApiClient(url)
            client.setAuthToken(token)
            val valid = try { client.isAuthenticated() } catch (_: Exception) { false }
            if (valid) {
                // Fetch user info
                val user = try { client.getMe() } catch (_: Exception) { null }
                if (user != null) {
                    prefs.edit()
                        .putString("user_name", user.name)
                        .putString("user_email", user.email)
                        .putString("user_role", user.role)
                        .apply()
                }
                goToMain()
            } else {
                // Token expired — show login form
                prefs.edit().remove("auth_token").apply()
                buildUI()
            }
        }
    }

    private fun buildUI() {
        val root = ScrollView(this).apply {
            setBackgroundColor(0xFF080A12.toInt())
            isVerticalScrollBarEnabled = false
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            gravity = Gravity.CENTER_HORIZONTAL
        }

        // Spacer
        container.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(0, dp(40))
        })

        // Logo
        val logo = ImageView(this).apply {
            setImageResource(R.drawable.qpiai_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            val size = dp(72)
            layoutParams = LinearLayout.LayoutParams(size, size).apply { bottomMargin = dp(16) }
        }
        container.addView(logo)

        // Title
        val titleText = TextView(this).apply {
            text = "QpiAI Nexus"; textSize = 28f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, Typeface.BOLD); letterSpacing = -0.02f
            gravity = Gravity.CENTER
        }
        titleText.post {
            val w = titleText.paint.measureText(titleText.text.toString())
            titleText.paint.shader = LinearGradient(0f, 0f, w, 0f,
                intArrayOf(0xFFF0F0F5.toInt(), 0xFF7B9FC7.toInt(), 0xFFD63384.toInt()),
                floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
            titleText.invalidate()
        }
        container.addView(titleText)

        container.addView(TextView(this).apply {
            text = "Sign in to connect your device"
            textSize = 13f; setTextColor(0xFF6B6B7E.toInt())
            gravity = Gravity.CENTER; setPadding(0, dp(4), 0, dp(32))
        })

        // Server URL
        container.addView(TextView(this).apply {
            text = "Server URL"; textSize = 12f; setTextColor(0xFF8B8B9E.toInt())
            setTypeface(null, Typeface.BOLD); setPadding(dp(4), 0, 0, dp(6))
        })
        serverUrlInput = EditText(this).apply {
            hint = "https://your-tunnel.trycloudflare.com"; textSize = 14f
            setTextColor(0xFFF0F0F5.toInt()); setHintTextColor(0xFF4B4B5E.toInt())
            background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.input_bg_dark)
            setPadding(dp(16), dp(14), dp(16), dp(14)); isSingleLine = true
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) }
        }
        val savedUrl = prefs.getString("server_url", "") ?: ""
        if (savedUrl.isNotEmpty()) serverUrlInput.setText(savedUrl)
        container.addView(serverUrlInput)

        // Email
        container.addView(TextView(this).apply {
            text = "Email"; textSize = 12f; setTextColor(0xFF8B8B9E.toInt())
            setTypeface(null, Typeface.BOLD); setPadding(dp(4), 0, 0, dp(6))
        })
        emailInput = EditText(this).apply {
            hint = "admin@nexus.local"; textSize = 14f
            setTextColor(0xFFF0F0F5.toInt()); setHintTextColor(0xFF4B4B5E.toInt())
            background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.input_bg_dark)
            setPadding(dp(16), dp(14), dp(16), dp(14)); isSingleLine = true
            inputType = android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) }
        }
        container.addView(emailInput)

        // Password
        container.addView(TextView(this).apply {
            text = "Password"; textSize = 12f; setTextColor(0xFF8B8B9E.toInt())
            setTypeface(null, Typeface.BOLD); setPadding(dp(4), 0, 0, dp(6))
        })
        passwordInput = EditText(this).apply {
            hint = "Password"; textSize = 14f
            setTextColor(0xFFF0F0F5.toInt()); setHintTextColor(0xFF4B4B5E.toInt())
            background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.input_bg_dark)
            setPadding(dp(16), dp(14), dp(16), dp(14)); isSingleLine = true
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(24) }
        }
        container.addView(passwordInput)

        // Login button
        loginButton = Button(this).apply {
            text = "Sign In"; textSize = 15f
            setTypeface(null, Typeface.BOLD)
            background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.btn_gradient_primary)
            setTextColor(0xFFFFFFFF.toInt()); setPadding(dp(16), dp(14), dp(16), dp(14)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
            setOnClickListener { doLogin() }
        }
        container.addView(loginButton)

        // Status text
        statusText = TextView(this).apply {
            text = ""; textSize = 12f; setTextColor(0xFFF87171.toInt())
            gravity = Gravity.CENTER; visibility = View.GONE
            setPadding(0, 0, 0, dp(12))
        }
        container.addView(statusText)

        // Divider
        val dividerRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(4), 0, dp(16))
        }
        dividerRow.addView(View(this).apply {
            setBackgroundColor(0xFF1E2030.toInt())
            layoutParams = LinearLayout.LayoutParams(0, dp(1), 1f)
        })
        dividerRow.addView(TextView(this).apply {
            text = "  OR  "; textSize = 11f; setTextColor(0xFF6B6B7E.toInt())
        })
        dividerRow.addView(View(this).apply {
            setBackgroundColor(0xFF1E2030.toInt())
            layoutParams = LinearLayout.LayoutParams(0, dp(1), 1f)
        })
        container.addView(dividerRow)

        // QR Code button
        container.addView(Button(this).apply {
            text = "\uD83D\uDCF7  Scan QR Code"; textSize = 14f; setTextColor(0xFF7B9FC7.toInt())
            background = ContextCompat.getDrawable(this@LoginActivity, R.drawable.input_bg_dark)
            setPadding(dp(16), dp(14), dp(16), dp(14)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
            setOnClickListener {
                qrScanLauncher.launch(Intent(this@LoginActivity, QRScanActivity::class.java))
            }
        })

        // Skip / Offline button
        container.addView(Button(this).apply {
            text = "Continue Offline"; textSize = 13f; setTextColor(0xFF6B6B7E.toInt())
            setBackgroundColor(0x00000000); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
            setOnClickListener {
                prefs.edit().putBoolean("offline_mode", true).apply()
                goToMain()
            }
        })

        root.addView(container)
        setContentView(root)
    }

    private fun doLogin() {
        val url = serverUrlInput.text.toString().trim()
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()

        if (url.isEmpty()) { showError("Enter a server URL"); return }
        if (email.isEmpty()) { showError("Enter your email"); return }
        if (password.isEmpty()) { showError("Enter your password"); return }

        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(serverUrlInput.windowToken, 0)

        loginButton.isEnabled = false
        loginButton.text = "Signing in..."
        statusText.visibility = View.GONE

        scope.launch {
            try {
                val client = NexusApiClient(url)
                val response = client.login(email, password)

                if (response.success && response.token != null) {
                    // Save auth state
                    prefs.edit()
                        .putString("server_url", url)
                        .putString("auth_token", response.token)
                        .putString("user_name", response.user?.name ?: email)
                        .putString("user_email", response.user?.email ?: email)
                        .putString("user_role", response.user?.role ?: "user")
                        .remove("offline_mode")
                        .apply()

                    goToMain()
                } else {
                    showError("Login failed")
                }
            } catch (e: Exception) {
                showError(e.message ?: "Login failed")
            } finally {
                loginButton.isEnabled = true
                loginButton.text = "Sign In"
            }
        }
    }

    private fun showError(msg: String) {
        statusText.text = msg
        statusText.visibility = View.VISIBLE
    }

    private fun goToMain() {
        startActivity(Intent(this, MainActivity::class.java))
        finish()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }
}
