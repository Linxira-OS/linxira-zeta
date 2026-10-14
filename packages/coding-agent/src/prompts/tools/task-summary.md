<task-result id="{{id}}" agent="{{agentName}}" status="{{status}}" duration="{{duration}}">
{{#if meta}}<meta lines="{{meta.lineCount}}" size="{{meta.charSize}}" />{{/if}}
{{#if abortReason}}
<abort-reason>{{abortReason}}{{#if resumable}} — the agent is still live with its full context; message it via `write agent://{{id}}` to resume instead of redoing the work.{{/if}}</abort-reason>
{{/if}}
{{#if failureClass}}
<failure class="{{failureClass}}" />{{/if}}
{{#if error}}
<error>{{error}}</error>
{{/if}}
{{#if modelChange}}
<model-change source="{{modelChange.source}}" to="{{modelChange.to}}"{{#if modelChange.from}} from="{{modelChange.from}}"{{/if}} />
{{/if}}
{{#if fallbackCandidates}}
<candidates>{{fallbackCandidates}}</candidates>
{{/if}}
{{#if modelSwitchHint}}
<retry-hint>{{modelSwitchHint}}</retry-hint>
{{/if}}
{{#if truncated}}
<preview full-output="agent://{{id}}">
{{preview}}
</preview>
{{else}}
<output>
{{preview}}
</output>
{{/if}}
{{#if mergeSummary}}
<merge-summary>
{{mergeSummary}}
</merge-summary>
{{/if}}
</task-result>
