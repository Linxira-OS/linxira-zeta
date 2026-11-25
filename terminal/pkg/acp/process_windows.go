// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package acp

import (
	"syscall"
	"unsafe"
)

const (
	createNoWindow        = 0x08000000
	createNewProcessGroup = 0x00000200

	jobObjectExtendedLimitInformation = 9
	jobObjectLimitKillOnJobClose      = 0x00002000

	processSetQuota     = 0x0100
	processTerminate    = 0x0001
	processQueryLimited = 0x1000
)

var (
	kernel32                     = syscall.NewLazyDLL("kernel32.dll")
	procCreateJobObjectW         = kernel32.NewProc("CreateJobObjectW")
	procSetInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
	procAssignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	procTerminateJobObject       = kernel32.NewProc("TerminateJobObject")
	procCloseHandle              = kernel32.NewProc("CloseHandle")
	procOpenProcess              = kernel32.NewProc("OpenProcess")
)

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectExtendedLimitInformationStruct struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

func processSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		CreationFlags: createNoWindow | createNewProcessGroup,
	}
}

// attachProcessTree puts the child in a job object so stopping the client
// terminates every process the agent spawned. Releasing the job handle also
// kills any stragglers (JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE).
func attachProcessTree(pid int) (kill func(), cleanup func(), err error) {
	job, _, callErr := procCreateJobObjectW.Call(0, 0)
	if job == 0 {
		return nil, nil, callErr
	}
	var info jobObjectExtendedLimitInformationStruct
	info.BasicLimitInformation.LimitFlags = jobObjectLimitKillOnJobClose
	ok, _, callErr := procSetInformationJobObject.Call(
		job,
		jobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		unsafe.Sizeof(info),
	)
	if ok == 0 {
		procCloseHandle.Call(job)
		return nil, nil, callErr
	}
	process, _, callErr := procOpenProcess.Call(
		processSetQuota|processTerminate|processQueryLimited,
		0,
		uintptr(uint32(pid)),
	)
	if process == 0 {
		procCloseHandle.Call(job)
		return nil, nil, callErr
	}
	ok, _, callErr = procAssignProcessToJobObject.Call(job, process)
	procCloseHandle.Call(process)
	if ok == 0 {
		procCloseHandle.Call(job)
		return nil, nil, callErr
	}
	return func() {
			procTerminateJobObject.Call(job, 1)
		}, func() {
			procCloseHandle.Call(job)
		}, nil
}
