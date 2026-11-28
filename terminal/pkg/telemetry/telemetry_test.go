package telemetry

import (
	"context"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/telemetry/telemetrydata"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

func TestZetaDisablesTelemetry(t *testing.T) {
	if !ZetaTelemetryDisabled {
		t.Fatal("Zeta must keep telemetry disabled at the package boundary")
	}
	if IsTelemetryEnabled() {
		t.Fatal("telemetry must report disabled regardless of config")
	}
	if err := RecordTEvent(context.Background(), telemetrydata.MakeTEvent("test:disabled", telemetrydata.TEventProps{})); err != nil {
		t.Fatalf("disabled telemetry must not write: %v", err)
	}
	if err := UpdateActivity(context.Background(), wshrpc.ActivityUpdate{FgMinutes: 1}); err != nil {
		t.Fatalf("disabled activity must not write: %v", err)
	}
}
