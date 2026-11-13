package com.zeta.android

import android.content.Context
import android.view.View
import android.widget.Toast
import androidx.core.content.ContextCompat

fun Context.dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

fun View.show() {
    visibility = View.VISIBLE
}

fun View.hide() {
    visibility = View.GONE
}

fun Context.toast(message: String) {
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
}

fun Context.color(id: Int): Int = ContextCompat.getColor(this, id)
