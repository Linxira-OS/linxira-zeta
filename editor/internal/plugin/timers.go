package plugin

import (
	"sync"
	"time"
)

// MinTimerIntervalMs floors ttt.set_interval — callbacks run on the main
// loop, so faster intervals would starve the UI.
const MinTimerIntervalMs = 50

// SetTimeout schedules fn once on the main loop after ms milliseconds.
func (p *Plugin) SetTimeout(ms int, fn func()) int {
	if ms < 0 {
		ms = 0
	}
	id := p.registerTimer(nil)
	t := time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
		p.SafePostAsync(&PluginAsyncResult{Plugin: p, Callback: func() {
			p.ClearTimer(id)
			fn()
		}})
	})
	p.setTimerCancel(id, func() { t.Stop() })
	return id
}

// SetInterval schedules fn on the main loop every ms milliseconds until cleared.
func (p *Plugin) SetInterval(ms int, fn func()) int {
	if ms < MinTimerIntervalMs {
		ms = MinTimerIntervalMs
	}
	stop := make(chan struct{})
	var once sync.Once
	id := p.registerTimer(func() { once.Do(func() { close(stop) }) })
	ticker := time.NewTicker(time.Duration(ms) * time.Millisecond)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				p.SafePostAsync(&PluginAsyncResult{Plugin: p, Callback: fn})
			}
		}
	}()
	return id
}

// ClearTimer cancels the timer with the given id; unknown ids are a no-op.
func (p *Plugin) ClearTimer(id int) {
	p.mu.Lock()
	cancel := p.timers[id]
	delete(p.timers, id)
	p.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (p *Plugin) registerTimer(cancel func()) int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.timers == nil {
		p.timers = make(map[int]func())
	}
	p.nextTimerID++
	id := p.nextTimerID
	p.timers[id] = cancel
	return id
}

func (p *Plugin) setTimerCancel(id int, cancel func()) {
	p.mu.Lock()
	_, active := p.timers[id]
	if active {
		p.timers[id] = cancel
	}
	p.mu.Unlock()
	if !active {
		cancel()
	}
}

// stopTimersLocked cancels all timers; caller must hold p.mu.
func (p *Plugin) stopTimersLocked() {
	for _, cancel := range p.timers {
		if cancel != nil {
			cancel()
		}
	}
	p.timers = nil
}
