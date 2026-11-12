package app.tramme.device

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ContentValues
import android.content.Intent
import android.content.SharedPreferences
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.OnBackPressedDispatcherOwner
import androidx.core.content.FileProvider
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** the provider of the share sheet, under our own name so it never clashes with another library's */
class TrammeFileProvider : FileProvider()

@InvokeArg
class SlotArgs {
    lateinit var slot: String
}

@InvokeArg
class SecretArgs {
    lateinit var slot: String
    lateinit var value: String
}

@InvokeArg
class FileArgs {
    lateinit var path: String
    lateinit var name: String
    lateinit var mime: String
}

@InvokeArg
class UrlArgs {
    lateinit var url: String
}

@InvokeArg
class AwakeArgs {
    var on: Boolean = false
}

/**
 * What the phone gives the Tramme app (the Rust half is plugin-device/src/lib.rs):
 * secrets under a key of the Android Keystore, saving to the gallery, the share
 * sheet, the screen kept awake, the back button.
 */
@TauriPlugin(
    permissions = [
        // only asked on Android 8 and 9, and only when saving; later versions need none
        Permission(strings = [Manifest.permission.WRITE_EXTERNAL_STORAGE], alias = "storage")
    ]
)
class DevicePlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs: SharedPreferences
        get() = activity.getSharedPreferences(SECRETS_FILE, Activity.MODE_PRIVATE)

    override fun load(webView: WebView) {
        super.load(webView)
        // the back button: the page decides what it closes (device.ts); a callback added later is asked first
        val owner = activity as? OnBackPressedDispatcherOwner ?: return
        owner.onBackPressedDispatcher.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                trigger("back", JSObject())
            }
        })
    }

    // ── secrets ──────────────────────────────────────────────────

    @Command
    fun getSecret(invoke: Invoke) {
        val args = invoke.parseArgs(SlotArgs::class.java)
        val answer = JSObject()
        try {
            prefs.getString(args.slot, null)?.let { answer.put("value", decrypt(it)) }
        } catch (e: Exception) {
            // a value the Keystore can no longer open (the key is gone): as if never set
            prefs.edit().remove(args.slot).apply()
        }
        invoke.resolve(answer)
    }

    @Command
    fun setSecret(invoke: Invoke) {
        val args = invoke.parseArgs(SecretArgs::class.java)
        try {
            prefs.edit().putString(args.slot, encrypt(args.value)).apply()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("the secret could not be kept")
        }
    }

    @Command
    fun deleteSecret(invoke: Invoke) {
        val args = invoke.parseArgs(SlotArgs::class.java)
        prefs.edit().remove(args.slot).apply()
        invoke.resolve(JSObject())
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    /** base64 of the IV then the ciphertext */
    private fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance(CIPHER)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_BYTES))
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    // ── saving and sharing a finished file ───────────────────────

    @Command
    fun save(invoke: Invoke) {
        // Android 8 and 9 write to the public folders themselves, so they ask first
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", invoke, "storageAnswered")
            return
        }
        saveNow(invoke)
    }

    @PermissionCallback
    fun storageAnswered(invoke: Invoke) {
        if (getPermissionState("storage") == PermissionState.GRANTED) saveNow(invoke) else invoke.reject("permission refused")
    }

    private fun saveNow(invoke: Invoke) {
        val args = invoke.parseArgs(FileArgs::class.java)
        // a copy of a long video: off the thread that serves the page
        Thread {
            try {
                copyToPublic(File(args.path), args.name, args.mime)
                invoke.resolve(JSObject())
            } catch (e: Exception) {
                invoke.reject("the file could not be saved")
            }
        }.start()
    }

    private fun copyToPublic(source: File, name: String, mime: String) {
        val folder = when {
            mime.startsWith("video/") -> Environment.DIRECTORY_MOVIES
            mime.startsWith("image/") -> Environment.DIRECTORY_PICTURES
            else -> Environment.DIRECTORY_DOWNLOADS
        }
        val ours = if (folder == Environment.DIRECTORY_DOWNLOADS) folder else "$folder/Tramme"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val collection = when (folder) {
                Environment.DIRECTORY_MOVIES -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                Environment.DIRECTORY_PICTURES -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, ours)
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val resolver = activity.contentResolver
            val target = resolver.insert(collection, values) ?: throw IllegalStateException("no place to save")
            try {
                resolver.openOutputStream(target)!!.use { out -> source.inputStream().use { it.copyTo(out) } }
                values.clear()
                values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                resolver.update(target, values, null, null)
            } catch (e: Exception) {
                resolver.delete(target, null, null)
                throw e
            }
        } else {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStoragePublicDirectory(folder), if (ours == folder) "" else "Tramme")
            dir.mkdirs()
            val copy = File(dir, name)
            source.copyTo(copy, overwrite = true)
            MediaScannerConnection.scanFile(activity, arrayOf(copy.absolutePath), arrayOf(mime), null)
        }
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(FileArgs::class.java)
        try {
            val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.tramme.files", File(args.path))
            val send = Intent(Intent.ACTION_SEND).apply {
                type = args.mime
                putExtra(Intent.EXTRA_STREAM, uri)
                // the chooser and the chosen app read it through the clip, not only the extra
                clipData = ClipData.newRawUri(args.name, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(Intent.createChooser(send, null))
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("the file could not be shared")
        }
    }

    // ── the screen and the app ───────────────────────────────────

    @Command
    fun keepAwake(invoke: Invoke) {
        val args = invoke.parseArgs(AwakeArgs::class.java)
        activity.runOnUiThread {
            if (args.on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        invoke.resolve(JSObject())
    }

    @Command
    fun openUrl(invoke: Invoke) {
        val args = invoke.parseArgs(UrlArgs::class.java)
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("no app opens this address")
        }
    }

    @Command
    fun exit(invoke: Invoke) {
        invoke.resolve(JSObject())
        activity.runOnUiThread { activity.finish() }
    }

    companion object {
        private const val SECRETS_FILE = "tramme-secrets"
        private const val KEY_ALIAS = "tramme-secrets"
        private const val CIPHER = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
    }
}
