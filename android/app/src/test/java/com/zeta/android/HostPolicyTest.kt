package com.zeta.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostPolicyTest {
    @Test
    fun parsesRootHttpsOrigin() {
        val host = HostPolicy.parse("https://Example.com:8443/")
        requireNotNull(host)
        assertEquals("https://example.com:8443", host.origin)
        assertEquals("https://example.com:8443/", host.baseUrl)
        assertEquals("example.com", host.host)
        assertEquals(8443, host.port)
        assertTrue(host.isSameOrigin("https://example.com:8443/workbench?x=1"))
        assertFalse(host.isSameOrigin("http://example.com:8443/"))
        assertFalse(host.isSameOrigin("https://example.com/"))
        assertFalse(host.isSameOrigin("https://other.example:8443/"))
    }

    @Test
    fun parsesBracketedIpv6() {
        val host = HostPolicy.parse("https://[::1]:8443/")
        requireNotNull(host)
        assertEquals("https://[::1]:8443", host.origin)
        assertEquals("::1", host.host)
        assertEquals("https://[::1]:8443/", host.baseUrl)
        assertTrue(host.isSameOrigin("https://[::1]:8443/workbench"))
    }

    @Test
    fun defaultsToPort443() {
        val host = HostPolicy.parse("https://zeta.example/")
        requireNotNull(host)
        assertEquals("https://zeta.example", host.origin)
        assertEquals("https://zeta.example/", host.baseUrl)
        assertEquals(443, host.port)
        assertTrue(host.isSameOrigin("https://zeta.example:443/path"))
    }

    @Test
    fun rejectsCleartextAmbiguousAndPrefixedUrls() {
        assertNull(HostPolicy.parse("http://zeta.example"))
        assertNull(HostPolicy.parse("https://user:pass@zeta.example"))
        assertNull(HostPolicy.parse("https://zeta.example/?x=1"))
        assertNull(HostPolicy.parse("https://zeta.example/#frag"))
        assertNull(HostPolicy.parse("https://zeta.example/a/../b"))
        assertNull(HostPolicy.parse("https://zeta.example/studio/"))
    }

    @Test
    fun normalizesBareHostToHttps() {
        assertEquals("https://zeta.example", HostPolicy.normalizeInput("zeta.example"))
        assertEquals("https://zeta.example", HostPolicy.normalizeInput("https://zeta.example"))
    }

    @Test
    fun onlySafeExternalSchemesAreAllowed() {
        assertTrue(HostPolicy.isSafeExternal("https://example.com"))
        assertTrue(HostPolicy.isSafeExternal("mailto:dev@example.com"))
        assertTrue(HostPolicy.isSafeExternal("tel:+15551234"))
        assertFalse(HostPolicy.isSafeExternal("http://example.com"))
        assertFalse(HostPolicy.isSafeExternal("intent://scan/#Intent;end"))
        assertFalse(HostPolicy.isSafeExternal("file:///etc/passwd"))
    }
}
