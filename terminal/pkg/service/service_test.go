// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package service

import "testing"

func TestValidateServiceMap(t *testing.T) {
	if err := ValidateServiceMap(); err != nil {
		t.Fatalf("invalid service map: %v", err)
	}
}
