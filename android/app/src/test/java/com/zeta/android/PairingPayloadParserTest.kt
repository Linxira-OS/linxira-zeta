package com.zeta.android

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PairingPayloadParserTest {
    @Test
    fun parsesCurrentPairingPayload() {
        val payload = PairingPayloadParser.parse("https://zeta.example:8443/#zeta-pair=AB12CD34")
        assertEquals("https://zeta.example:8443", payload.host.origin)
        assertEquals("https://zeta.example:8443/", payload.host.baseUrl)
        assertEquals("AB12CD34", payload.code)
    }

    @Test
    fun rejectsLegacyMachineTokenPayload() {
        assertThrows(PairingPayloadException.Legacy::class.java) {
            PairingPayloadParser.parse("https://zeta.example/#zeta-token=zdt_secret")
        }
    }

    @Test
    fun rejectsCleartextAndMissingCode() {
        assertThrows(PairingPayloadException.Invalid::class.java) {
            PairingPayloadParser.parse("http://zeta.example/#zeta-pair=AB12")
        }
        assertThrows(PairingPayloadException.Invalid::class.java) {
            PairingPayloadParser.parse("https://zeta.example/#nothing=AB12")
        }
        assertThrows(PairingPayloadException.Invalid::class.java) {
            PairingPayloadParser.parse("https://zeta.example/#zeta-pair=")
        }
    }

    @Test
    fun rejectsDuplicateFragmentKeys() {
        assertThrows(PairingPayloadException.Invalid::class.java) {
            PairingPayloadParser.parse("https://zeta.example/#zeta-pair=A&zeta-pair=B")
        }
    }

    @Test
    fun rejectsReverseProxyPathPrefix() {
        assertThrows(PairingPayloadException.Invalid::class.java) {
            PairingPayloadParser.parse("https://zeta.example/studio/#zeta-pair=AB12")
        }
    }
}
