package com.newlife.mobile

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** مسح الباركود مباشرة بالكاميرا (كل الأنواع) دون إنترنت. */
class BarcodeActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_RESULT = "result"

        fun formatName(f: Int): String = when (f) {
            Barcode.FORMAT_QR_CODE -> "QR"
            Barcode.FORMAT_EAN_13 -> "EAN-13"
            Barcode.FORMAT_EAN_8 -> "EAN-8"
            Barcode.FORMAT_UPC_A -> "UPC-A"
            Barcode.FORMAT_UPC_E -> "UPC-E"
            Barcode.FORMAT_CODE_128 -> "Code 128"
            Barcode.FORMAT_CODE_39 -> "Code 39"
            Barcode.FORMAT_CODE_93 -> "Code 93"
            Barcode.FORMAT_CODABAR -> "Codabar"
            Barcode.FORMAT_ITF -> "ITF"
            Barcode.FORMAT_DATA_MATRIX -> "Data Matrix"
            Barcode.FORMAT_PDF417 -> "PDF417"
            Barcode.FORMAT_AZTEC -> "Aztec"
            else -> "باركود"
        }

        fun toJson(list: List<Barcode>): JSONArray {
            val arr = JSONArray()
            for (b in list) {
                val text = b.rawValue ?: b.displayValue ?: continue
                arr.put(JSONObject().put("text", text).put("format", formatName(b.format)))
            }
            return arr
        }
    }

    private lateinit var preview: PreviewView
    private lateinit var hint: TextView
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private var scanner: BarcodeScanner? = null
    private var camera: Camera? = null
    private var torch = false
    @Volatile private var done = false

    private val permission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera() else {
            Toast.makeText(this, "يلزم السماح باستخدام الكاميرا", Toast.LENGTH_LONG).show()
            finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        preview = PreviewView(this)
        root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // إطار التوجيه في المنتصف
        val frame = android.view.View(this).apply {
            background = GradientDrawable().apply {
                setStroke(6, Color.parseColor("#3CC3A3"))
                cornerRadius = 36f
                setColor(Color.TRANSPARENT)
            }
        }
        val size = (resources.displayMetrics.widthPixels * 0.72).toInt()
        root.addView(frame, FrameLayout.LayoutParams(size, (size * 0.75).toInt(), Gravity.CENTER))

        hint = TextView(this).apply {
            text = "وجّه الكاميرا إلى الباركود أو رمز QR"
            setTextColor(Color.WHITE)
            textSize = 16f
            gravity = Gravity.CENTER
            setPadding(40, 24, 40, 24)
            background = GradientDrawable().apply { setColor(Color.parseColor("#AA000000")); cornerRadius = 40f }
        }
        root.addView(hint, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = 220 })

        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        val close = Button(this).apply { text = "إغلاق"; setOnClickListener { finish() } }
        val light = Button(this).apply {
            text = "الإضاءة"
            setOnClickListener {
                torch = !torch
                camera?.cameraControl?.enableTorch(torch)
            }
        }
        bar.addView(light)
        bar.addView(close)
        root.addView(bar, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = 90 })
        setContentView(root)

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera()
        else permission.launch(Manifest.permission.CAMERA)
    }

    private fun startCamera() {
        val sc = BarcodeScanning.getClient(BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS).build())
        scanner = sc
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            try {
                val provider = future.get()
                val pv = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                val analysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                analysis.setAnalyzer(executor) { proxy ->
                    if (done) { proxy.close(); return@setAnalyzer }
                    val rotation = proxy.imageInfo.rotationDegrees
                    val bmp = try { proxy.toBitmap() } catch (e: Exception) { null } finally { proxy.close() }
                    if (bmp == null) return@setAnalyzer
                    try {
                        val list = Tasks.await(sc.process(InputImage.fromBitmap(bmp, rotation)))
                        if (list.isNotEmpty() && !done) {
                            done = true
                            runOnUiThread { finishWith(list) }
                        }
                    } catch (_: Exception) {
                    }
                }
                provider.unbindAll()
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, pv, analysis)
            } catch (e: Exception) {
                Toast.makeText(this, "تعذر تشغيل الكاميرا: ${e.message}", Toast.LENGTH_LONG).show()
                finish()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun finishWith(list: List<Barcode>) {
        try {
            ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80).startTone(ToneGenerator.TONE_PROP_BEEP, 150)
        } catch (_: Exception) {
        }
        setResult(RESULT_OK, Intent().putExtra(EXTRA_RESULT, toJson(list).toString()))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdown()
        scanner?.close()
    }
}
