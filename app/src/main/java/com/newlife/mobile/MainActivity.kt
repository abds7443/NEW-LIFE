package com.newlife.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File

/**
 * الشاشة الرئيسية: واجهة NEW LIFE (ملفات HTML/JS داخل التطبيق تعمل دون إنترنت)
 * مع جسر إلى قدرات الهاتف: الحفظ، المشاركة، الكاميرا، الماسح الذكي، قراءة النصوص،
 * الترجمة، القراءة بصوت، الباركود، والتشفير.
 */
class MainActivity : AppCompatActivity() {

    lateinit var web: WebView
    lateinit var bridge: NativeBridge
    private lateinit var assetLoader: WebViewAssetLoader

    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var cameraUri: Uri? = null
    private var pendingPermission: ((Boolean) -> Unit)? = null
    private var activityResultHandler: ((ActivityResult) -> Unit)? = null
    private var senderResultHandler: ((ActivityResult) -> Unit)? = null

    private var pageReady = false
    private var pendingOpen: JSONObject? = null

    // ───────── مُطلقات النتائج ─────────
    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val uris = mutableListOf<Uri>()
        val data = res.data
        if (res.resultCode == RESULT_OK && data != null) {
            data.clipData?.let { clip -> for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri) }
            if (uris.isEmpty()) data.data?.let { uris.add(it) }
        }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }

    private val takePicture = registerForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val cb = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val u = cameraUri
        cb.onReceiveValue(if (ok && u != null) arrayOf(u) else null)
    }

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val p = pendingPermission
        pendingPermission = null
        p?.invoke(granted)
    }

    private val forResult = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val h = activityResultHandler
        activityResultHandler = null
        h?.invoke(res)
    }

    private val forSender = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { res ->
        val h = senderResultHandler
        senderResultHandler = null
        h?.invoke(res)
    }

    fun launchForResult(intent: Intent, handler: (ActivityResult) -> Unit) {
        activityResultHandler = handler
        try {
            forResult.launch(intent)
        } catch (e: Exception) {
            activityResultHandler = null
            handler(ActivityResult(RESULT_CANCELED, null))
            toast("تعذر فتح النافذة: ${e.message}")
        }
    }

    fun launchSender(request: IntentSenderRequest, handler: (ActivityResult) -> Unit) {
        senderResultHandler = handler
        forSender.launch(request)
    }

    fun withCamera(block: (Boolean) -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            block(true)
        } else {
            pendingPermission = block
            permission.launch(Manifest.permission.CAMERA)
        }
    }

    fun toast(msg: String) = runOnUiThread { Toast.makeText(this, msg, Toast.LENGTH_LONG).show() }

    // ───────── الإنشاء ─────────
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Blobs.init(this)
        bridge = NativeBridge(this)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/blobs/", WebViewAssetLoader.InternalStoragePathHandler(this, Blobs.dir))
            .build()

        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            setSupportZoom(false)
            textZoom = 100
        }
        web.addJavascriptInterface(bridge, "Android")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.host == "appassets.androidplatform.net") return false
                // الروابط الخارجية (نتيجة باركود مثلاً) تُفتح في المتصفح
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                } catch (_: Exception) {
                    toast("لا يوجد تطبيق لفتح هذا الرابط")
                }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val accept = params.acceptTypes.filter { it.isNotBlank() }
                if (params.isCaptureEnabled && (accept.isEmpty() || accept.any { it.startsWith("image") })) {
                    openCamera()
                } else {
                    openPicker(accept, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return true
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("(window.NL_back && window.NL_back()) ? 'y' : 'n'") { r ->
                    if (r?.contains("y") != true) {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })

        if (savedInstanceState == null) {
            web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
        } else {
            web.restoreState(savedInstanceState)
        }
        handleIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        bridge.shutdown()
        super.onDestroy()
    }

    // ───────── اختيار الملفات والكاميرا لعناصر <input type=file> ─────────
    private fun openPicker(accept: List<String>, multiple: Boolean) {
        val mimes = accept.flatMap { it.split(",") }.map { it.trim() }.filter { it.isNotEmpty() }.map { a ->
            if (a.startsWith(".")) MimeTypeMap.getSingleton().getMimeTypeFromExtension(a.substring(1).lowercase()) ?: "*/*" else a
        }.distinct()
        val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            if (mimes.isNotEmpty() && !mimes.contains("*/*")) putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
            if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        try {
            chooser.launch(Intent.createChooser(intent, "اختر ملفاً"))
        } catch (e: Exception) {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            toast("تعذر فتح مدير الملفات")
        }
    }

    private fun openCamera() {
        withCamera { granted ->
            if (!granted) {
                fileCallback?.onReceiveValue(null)
                fileCallback = null
                toast("يلزم السماح باستخدام الكاميرا")
                return@withCamera
            }
            val dir = File(cacheDir, "camera").apply { mkdirs() }
            val f = File(dir, "IMG_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "$packageName.files", f)
            cameraUri = uri
            try {
                takePicture.launch(uri)
            } catch (e: Exception) {
                fileCallback?.onReceiveValue(null)
                fileCallback = null
                toast("لا يوجد تطبيق كاميرا")
            }
        }
    }

    // ───────── فتح ملف أُرسل إلى التطبيق (فتح باستخدام / مشاركة) ─────────
    private fun handleIntent(intent: Intent?) {
        if (intent == null) return
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            else -> null
        }
        if (uri == null) {
            if (intent.action == Intent.ACTION_SEND) {
                val text = intent.getStringExtra(Intent.EXTRA_TEXT)
                if (!text.isNullOrBlank()) deliverOpen(JSONObject().put("text", text))
            }
            return
        }
        Thread {
            try {
                val name = displayName(uri)
                val mime = contentResolver.getType(uri) ?: ""
                val token = Blobs.fromUri(this, uri, name)
                deliverOpen(JSONObject().put("url", Blobs.url(token)).put("name", name).put("mime", mime))
            } catch (e: Exception) {
                toast("تعذر فتح الملف: ${e.message}")
            }
        }.start()
    }

    fun displayName(uri: Uri): String {
        var name: String? = null
        try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) name = c.getString(0)
            }
        } catch (_: Exception) {
        }
        return name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "ملف"
    }

    private fun deliverOpen(o: JSONObject) {
        runOnUiThread {
            if (pageReady) {
                web.evaluateJavascript("window.NL_openExternal && window.NL_openExternal(${o})", null)
            } else {
                pendingOpen = o
            }
        }
    }

    /** تستدعيها الواجهة عند اكتمال تحميلها. */
    fun onPageReady() {
        runOnUiThread {
            pageReady = true
            pendingOpen?.let { o ->
                pendingOpen = null
                web.evaluateJavascript("window.NL_openExternal && window.NL_openExternal(${o})", null)
            }
        }
    }

    /** إرجاع نتيجة عملية غير متزامنة إلى الواجهة. */
    fun reply(cb: String, ok: Boolean, payload: Any?) {
        val js = "window.NLNative && window.NLNative.done(${JSONObject.quote(cb)}, $ok, ${JSONObject.quote(payload?.toString() ?: "")})"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }
}
