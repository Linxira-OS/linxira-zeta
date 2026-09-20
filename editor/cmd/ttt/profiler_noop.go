//go:build !profiler

package main

func startProfiler() func() {
	return func() {}
}
