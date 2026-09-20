//go:build profiler

package main

import (
	"fmt"
	"os"
	"runtime"
	"runtime/pprof"
)

func init() {
	profilerEnabled = true
}

func startProfiler() func() {
	cpuFile, err := os.Create("cpu.prof")
	if err != nil {
		fmt.Fprintf(os.Stderr, "profiler: could not create cpu.prof: %v\n", err)
		os.Exit(1)
	}
	pprof.StartCPUProfile(cpuFile)

	return func() {
		pprof.StopCPUProfile()
		cpuFile.Close()
		fmt.Fprintln(os.Stderr, "profiler: wrote cpu.prof")

		memFile, err := os.Create("mem.prof")
		if err != nil {
			fmt.Fprintf(os.Stderr, "profiler: could not create mem.prof: %v\n", err)
			return
		}
		runtime.GC()
		pprof.WriteHeapProfile(memFile)
		memFile.Close()
		fmt.Fprintln(os.Stderr, "profiler: wrote mem.prof")
	}
}
