# ZetaContextManager — Dual State Machine for Context Management

ZetaContextManager implements two state machines that monitor and manage the
agent's context window to prevent token overflow and improve long-session
stability. It is **disabled by default** and must be explicitly enabled via
settings.

## State Machines

### State Machine A: Threshold → Memory Write

Monitors context token usage **before each model call**. When the token count
exceeds `zeta.contextCache.thresholdTokens` (default 400K), it injects a
`SoftToolRequirement` requesting the model to call `memory_edit` to save
important information to persistent memory before it gets evicted by compaction.

```
Context usage check → tokens ≥ threshold? → inject SoftToolRequirement
                                              (memory_edit reminder)
```

### State Machine B: EndTurn → Compression

Monitors queued messages **before dequeue**. When an `endTurn` tag is detected
on the last assistant message, it triggers `runAutoCompaction` to reduce context
size, keeping the session lean.

```
Queue check → last message has endTurn? → trigger runAutoCompaction
```

## Settings

All settings are under the `zeta.contextCache` namespace:

| Setting | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Master switch for both state machines |
| `thresholdTokens` | `number` | `400000` | Token threshold for memory write trigger |
| `memoryWriteEnabled` | `boolean` | `true` | Enable State Machine A (threshold → memory write) |
| `endTurnCompactionEnabled` | `boolean` | `true` | Enable State Machine B (endTurn → compaction) |

### Configuration Example

```yaml
# ~/.zeta/config.yml
zeta:
  contextCache:
    enabled: true
    thresholdTokens: 400000
    memoryWriteEnabled: true
    endTurnCompactionEnabled: true
```

## Integration

ZetaContextManager is instantiated in `AgentSession` and registers hooks on the
`Agent` instance:

```typescript
const manager = new ZetaContextManager(host);
manager.register(agent);
```

The `host` must implement the `ZetaContextManagerHost` interface, providing:
- `settings` — access to user configuration
- `getContextUsage()` — current token usage
- `runAutoCompaction()` — trigger compaction
- `findLastAssistantMessage()` — last assistant message for endTurn detection

## SoftToolRequirement

When the threshold is exceeded, the manager provides a `SoftToolRequirement`:

```typescript
{
  soft: true,
  toolName: "memory_edit",
  reminder: "Your context is approaching the token limit. Please use the
             `memory_edit` tool to save important information..."
}
```

The `soft` flag means the model is encouraged but not required to call the tool.
The requirement is cleared automatically when context drops below the threshold.

## Design Principles

- **Non-invasive**: Both state machines are disabled by default; enabling them
  adds monitoring without modifying existing compaction or memory logic
- **Default-off**: New mechanisms are additive; the original OMP behavior is
  preserved when disabled
- **Debounced**: State Machine B uses a `#endTurnCompactionPending` flag to
  prevent duplicate compaction triggers