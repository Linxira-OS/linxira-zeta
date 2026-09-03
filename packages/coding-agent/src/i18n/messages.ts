/**
 * Translatable CLI strings.
 *
 * Architecture (mirrors the pi/reasonix i18n pattern): a single flat
 * `Messages` interface of string fields, plus one full catalogue per language
 * (`en.ts`, `zh.ts`). Call sites read `M.SomeField` from `../i18n`; fields
 * whose values embed dynamic content are marked with a `*Fmt` suffix and
 * passed through a formatter at the call site.
 *
 * Adding a field requires updating every catalogue file — TypeScript's
 * `satisfies Messages` makes a missing field a compile error, and
 * `messages.test.ts` verifies the runtime key sets stay identical and
 * non-empty so a translation can never silently ship as a blank line.
 *
 * Scope: user-facing CLI/TUI surface only — welcome, setup wizard, slash
 * command descriptions, status lines, approvals, user-facing CLI errors.
 * System prompts, internal error wrappers, and agent runtime telemetry stay
 * English so model behaviour and developer logs are language-stable.
 *
 * Catalogue values do not include trailing newlines — call sites add framing
 * whitespace, so the same field works wherever it appears.
 */
export interface Messages {
	// welcome box
	welcomeBack: string; // heading above the logo
	welcomeNoRecentSessions: string; // "No recent sessions" row
	welcomeNoLspServers: string; // "No LSP servers" row
	welcomeTipsTitle: string; // right-column "Tips" heading
	welcomeLspServersTitle: string; // right-column "LSP Servers" heading
	welcomeRecentSessionsTitle: string; // right-column "Recent sessions" heading
	welcomePromptActionsHint: string; // "#" hint suffix
	welcomeCommandsHint: string; // "/" hint suffix
	welcomeRunBashHint: string; // "!" hint suffix
	welcomeRunPythonHint: string; // "$" hint suffix
	welcomeTipLabel: string; // "Tip: " label before the tip body
	welcomeNewTag: string; // rainbow tag replacing the "[NEW]" tip marker
	welcomeNerdFontJoke: string; // unicode-symbol joke tip

	// /language command
	languageCurrentFmt: string; // "Current language: %s"
	languageHint: string; // usage line for /language
	languageUnknownFmt: string; // "Unknown language: %s"
	languageChangedFmt: string; // "/language <tag>" succeeded, %s = tag
	languageListRowFmt: string; // "%s (%s)" listing row, %s = tag, %s = local name
	languageEnLabel: string; // local name of English
	languageZhLabel: string; // local name of Chinese
	cmdLanguage: string; // /language menu description

	// setup wizard shell
	setupFallbackTitle: string; // wizard scene-title fallback
	setupStepFmt: string; // "Setup step %s of %s" header line
	setupFooterHint: string; // wizard footer key hints
	setupSkipHint: string; // splash "press enter to skip"
	setupOutroTitle: string; // "Setup saved"
	setupOutroSubtitle: string; // "Handing off to the normal CLI…"

	// setup wizard: glyph mode scene
	setupGlyphTitle: string;
	setupGlyphSubtitle: string;
	setupGlyphHint: string; // "If a row shows boxes, tofu, or misaligned icons, pick another."
	setupGlyphLabelNerd: string;
	setupGlyphLabelUnicode: string;
	setupGlyphLabelAscii: string;

	// setup wizard: default model scene
	setupModelTitle: string;
	setupModelSubtitle: string;
	setupModelDiscovering: string; // "Discovering available models…"
	setupModelSearchHint: string; // "Type to search. Enter saves the highlighted model as your default."
	setupModelSavingFmt: string; // "Saving %s as the default model…", %s = selector

	// setup wizard: providers scene (sign-in + web search tabs)
	setupProvidersTitle: string;
	setupProvidersSubtitle: string;
	setupProvidersTab: string; // tab bar label

	// setup wizard: sign-in tab
	setupSignInLabel: string; // tab label
	setupSignInHint: string; // "Pick a provider to sign in — you can connect more than one."
	setupSignInSigningInFmt: string; // "Signing in to %s", %s = provider id
	setupSignInBrowserLoginFmt: string; // "Browser login: %s %s", %s = link, %s = copy hint
	setupSignInOpenUrl: string; // hyperlink label inside the login URL
	setupSignInClipboardHint: string; // "(clipboard copy attempted; Alt+C retries)"
	setupSignInLocalShortcutFmt: string; // "Local shortcut (this machine only): %s", %s = launch url
	setupSignInStartingOAuth: string; // "Starting OAuth flow…"
	setupSignInPasteCodeHint: string; // "Paste the returned code or redirect URL when prompted."
	setupSignInPasteCodePrompt: string; // "Paste the authorization code (or full redirect URL):"
	setupSignInSignedInFmt: string; // "Signed in to %s", %s = provider id
	setupSignInCredentialsFmt: string; // "Credentials saved to %s", %s = db path
	setupSignInCancelled: string; // "Login cancelled."
	setupSignInFailedFmt: string; // "Login failed: %s", %s = error message
	setupSignInRetryHint: string; // "Choose another provider or press Esc to continue."

	// setup wizard: web search tab
	setupWebSearchLabel: string; // tab label
	setupWebSearchHint: string; // "Choose the provider the web_search tool should prefer."
	setupWebSearchSetFmt: string; // "Web search set to %s", %s = provider label
	setupWebSearchNotConfigured: string; // "Not configured yet — add its API key or sign in to enable it."
	setupWebSearchAuto: string; // "Automatically uses the first configured provider."
	setupWebSearchChecking: string; // "Checking availability…"
	setupWebSearchReady: string; // "Ready to use"
	setupWebSearchNeedsCreds: string; // "Needs credentials"

	// setup wizard: theme scene
	setupThemeTitle: string;
	setupThemeSubtitle: string;
	setupThemeLiveHint: string; // "Theme changes preview live. Nothing is saved until you press Enter."
	setupThemeBrowsing: string; // "Browsing all themes · Esc returns to curated choices"
	setupThemeEscHint: string; // "Esc skips this step"
	setupThemeLoading: string; // "Loading themes…"
	setupThemeCurrentTag: string; // "current" marker on the active theme row
	setupThemeLoadFailedFmt: string; // "Failed to load themes: %s", %s = error message
	setupThemePreviewFailed: string; // "Theme preview failed"
	setupThemeAutoLabel: string; // "Match terminal"
	setupThemeAutoDesc: string; // "Titanium in dark terminals, Light in light terminals"
	setupThemeTitaniumLabel: string;
	setupThemeTitaniumDesc: string; // "Default dark theme"
	setupThemeLightLabel: string;
	setupThemeLightDesc: string; // "Default light theme"
	setupThemeColorblindLabel: string; // "Colorblind colors"
	setupThemeColorblindDesc: string; // "Adjust red/green contrast"
	setupThemeAnsiLabel: string; // "ANSI-safe"
	setupThemeAnsiDesc: string; // "ASCII glyphs with the dark terminal theme"
	setupThemeBrowseLabel: string; // "Browse all…"
	setupThemeBrowseDesc: string; // "Show every built-in and custom theme"
	setupThemePreviewTitle: string; // "Preview" heading
	setupThemeStatusLineLabel: string; // "Status line" mock label
	setupThemeEditorLabel: string; // "Editor" mock label
	setupThemeMockPrompt: string; // mock editor prompt line
	setupThemeMockHint: string; // mock editor hint line
	setupThemeSwatchSuccess: string;
	setupThemeSwatchWarning: string;
	setupThemeSwatchError: string;
	setupThemeSwatchAccent: string;

	// provider setup (standalone command entry)
	setupProviderUnavailable: string; // "Provider setup is unavailable."
	// slash command descriptions
	cmdAddAMarketplaceSource: string; // Add a marketplace source
	cmdAddANewMCPServer: string; // Add a new MCP server
	cmdAddAWorkspaceDirectoryToThisSession: string; // Add a workspace directory to this session
	cmdAddAWorkspaceDirectoryToThisSessionMultiRoot: string; // Add a workspace directory to this session (multi-root)
	cmdAddAnSSHHost: string; // Add an SSH host
	cmdAdjustTheTokenBudget: string; // Adjust the token budget
	cmdAliasForClear: string; // Alias for clear
	cmdAliasForEnqueue: string; // Alias for enqueue
	cmdAlwaysExposeInspectImageThisSession: string; // Always expose inspect_image this session
	cmdAppendATaskPhaseFuzzyMatchedOrAutoCreated: string; // Append a task; phase fuzzy-matched or auto-created
	cmdAskAnEphemeralSideQuestionUsingTheCurrentSessionContext: string; // Ask an ephemeral side question using the current session context
	cmdBrowseAvailablePlugins: string; // Browse available plugins
	cmdCancelARunningNativeScan: string; // Cancel a running native scan
	cmdClearConversationContext: string; // Clear the conversation context in place, keeping the session
	cmdClearPersistedMemoryDataAndArtifacts: string; // Clear persisted memory data and artifacts
	cmdCompactTheConversation: string; // Compact the conversation
	cmdCompareFindingLineageAcrossTwoScans: string; // Compare finding lineage across two scans
	cmdConfigureSignInAndWebSearchProviders: string; // Configure sign-in and web search providers
	cmdControlTheInspectImageVisionDelegationToolForThisSession: string; // Control the inspect_image vision-delegation tool for this session
	cmdCopySessionTranscriptToClipboardAndWriteLLMRequestJSONToTmp: string; // Copy session transcript to clipboard (and write LLM request JSON to tmp)
	cmdCopyTheAdvisorSTranscriptToClipboard: string; // Copy the advisor's transcript to clipboard
	cmdCopyTodosAsMarkdownToClipboard: string; // Copy todos as Markdown to clipboard
	cmdCreateANewBranchFromAPreviousMessage: string; // Create a new branch from a previous message
	cmdCreateANewForkFromAPreviousMessage: string; // Create a new fork from a previous message
	cmdCreateAnImmutableSecurityScanPlan: string; // Create an immutable security scan plan
	cmdCreateAnyBuiltInMentalModelsThatAreMissing: string; // Create any built-in mental models that are missing
	cmdDeleteAMentalModelFromTheBankIdRequired: string; // Delete a mental model from the bank (id required)
	cmdDeleteCurrentSessionAndReturnToSelector: string; // Delete current session and return to selector
	cmdDeleteTheCurrentSessionAndStartANewOne: string; // Delete the current session and start a new one
	cmdDiffTheChangeHistoryOfAMentalModel: string; // Diff the change history of a mental model
	cmdDisableAMarketplacePlugin: string; // Disable a marketplace plugin
	cmdDisableAnMCPServer: string; // Disable an MCP server
	cmdDisableComputerUseForThisSession: string; // Disable computer use for this session
	cmdDisableFastMode: string; // Disable fast mode
	cmdDisableTheAdvisor: string; // Disable the advisor
	cmdDropHeavyContentFromContextToolResultsLargeBlocks: string; // Drop heavy content from context (tool results, large blocks)
	cmdDropTheCurrentGoal: string; // Drop the current goal
	cmdEnableAMarketplacePlugin: string; // Enable a marketplace plugin
	cmdEnableAnMCPServer: string; // Enable an MCP server
	cmdEnableComputerUseForThisSession: string; // Enable computer use for this session
	cmdEnableFastMode: string; // Enable fast mode
	cmdEnableTheAdvisor: string; // Enable the advisor
	cmdEnglish: string; // English
	cmdEnqueueMemoryConsolidationMaintenance: string; // Enqueue memory consolidation maintenance
	cmdExitTheApplication: string; // Exit the application
	cmdExportACanonicalBundleSARIFOrReport: string; // Export a canonical bundle, SARIF, or report
	cmdExportSessionToHTMLFile: string; // Export session to HTML file
	cmdFollowInspectImageModeAutoHidesItForVisionCapableModels: string; // Follow inspect_image.mode (auto hides it for vision-capable models)
	cmdForceNextTurnToUseASpecificTool: string; // Force next turn to use a specific tool
	cmdForceReloadMCPRuntimeTools: string; // Force reload MCP runtime tools
	cmdForgeATTSRRuleFromAComplaintToStopARecurringBehavior: string; // Forge a TTSR rule from a complaint to stop a recurring behavior
	cmdFreezeAllAgentsMainSubagentsAdvisorUntilResumed: string; // Freeze all agents (main, subagents, advisor) until resumed
	cmdHandOffSessionContextToANewSession: string; // Hand off session context to a new session
	cmdHaveTheAgentInterviewYouInChatThenSetUpGoalMode: string; // Have the agent interview you in chat, then set up goal mode
	cmdImportSARIFOrACodexSecurityBundle: string; // Import SARIF or a Codex Security bundle
	cmdInspectAndOperateMemoryMaintenance: string; // Inspect and operate memory maintenance
	cmdInstallAPluginInteractiveBrowserIfNoArgs: string; // Install a plugin (interactive browser if no args)
	cmdJoinASharedCollabSession: string; // Join a shared collab session
	cmdLaunchTheLocalStatsDashboard: string; // Launch the local stats dashboard
	cmdLeaveTheCollabSession: string; // Leave the collab session
	cmdListAllConfiguredMCPServers: string; // List all configured MCP servers
	cmdListAllConfiguredSSHHosts: string; // List all configured SSH hosts
	cmdListAllInstalledPluginsNpmMarketplace: string; // List all installed plugins (npm + marketplace)
	cmdListAvailablePromptsFromConnectedServers: string; // List available prompts from connected servers
	cmdListAvailableResourcesFromConnectedServers: string; // List available resources from connected servers
	cmdListConfiguredMarketplaces: string; // List configured marketplaces
	cmdListInstalledMarketplacePlugins: string; // List installed marketplace plugins
	cmdListMentalModelsOnTheActiveBank: string; // List mental models on the active bank
	cmdListStoredProjectSecurityScans: string; // List stored project security scans
	cmdListThisSessionSWorkspaceDirectories: string; // List this session's workspace directories
	cmdLoginToSmitheryAndCacheAPIKey: string; // Login to Smithery and cache API key
	cmdLoginWithOAuthProvider: string; // Login with OAuth provider
	cmdLogoutFromOAuthProvider: string; // Logout from OAuth provider
	cmdManageMarketplacePluginSourcesAndInstalledPlugins: string; // Manage marketplace plugin sources and installed plugins
	cmdManageMCPServers: string; // Manage MCP servers
	cmdManageMCPServersAddListRemoveTest: string; // Manage MCP servers (add, list, remove, test)
	cmdManageMemory: string; // Manage memory
	cmdManagePlugins: string; // Manage plugins
	cmdManagePluginsFromMarketplaces: string; // Manage plugins from marketplaces
	cmdManageSSHConnections: string; // Manage SSH connections
	cmdManageSSHHostsAddListRemove: string; // Manage SSH hosts (add, list, remove)
	cmdManageTodos: string; // Manage todos
	cmdManuallyCompactTheSessionContext: string; // Manually compact the session context
	cmdMarkTaskInProgressFuzzyMatched: string; // Mark task in_progress (fuzzy-matched)
	cmdMarkTaskPhaseAllAbandonedFuzzyMatched: string; // Mark task/phase/all abandoned (fuzzy-matched)
	cmdMarkTaskPhaseAllCompletedFuzzyMatched: string; // Mark task/phase/all completed (fuzzy-matched)
	cmdMoveTheCurrentSessionToADifferentDirectory: string; // Move the current session to a different directory
	cmdNavigateSessionTreeSwitchBranches: string; // Navigate session tree (switch branches)
	cmdNeverExposeInspectImageThisSession: string; // Never expose inspect_image this session
	cmdOpenAgentControlCenterDashboard: string; // Open Agent Control Center dashboard
	cmdOpenDebugToolsSelector: string; // Open debug tools selector
	cmdOpenExtensionControlCenterDashboard: string; // Open Extension Control Center dashboard
	cmdOpenProviderSetup: string; // Open provider setup
	cmdOpenSettingsMenu: string; // Open settings menu
	cmdOpenTheAdvisorConfigurationEditorTUI: string; // Open the advisor configuration editor (TUI)
	cmdOpenTodosInEDITORMarkdownRoundTrip: string; // Open todos in $EDITOR (Markdown round-trip)
	cmdPauseTheCurrentGoal: string; // Pause the current goal
	cmdPickTextOrCodeFromTheConversationToCopy: string; // Pick text or code from the conversation to copy
	cmdPinTheCurrentProviderToAStoredOAuthAccount: string; // Pin the current provider to a stored OAuth account
	cmdPlanRunInspectImportAndCompareZetaSecurityScans: string; // Plan, run, inspect, import, and compare Zeta security scans
	cmdPrewalkAtTheNextAction: string; // Prewalk at the next action
	cmdQueueAMessageForAfterTheAgentYields: string; // Queue a message for after the agent yields
	cmdQuitTheApplication: string; // Quit the application
	cmdReOpenThePlanReviewForTheLatestPlanPlanModeOnly: string; // Re-open the plan review for the latest plan (plan mode only)
	cmdRePullTheCachedMentalModelsBlock: string; // Re-pull the cached <mental_models> block
	cmdReauthorizeOAuthForAServer: string; // Reauthorize OAuth for a server
	cmdReconnectToASpecificMCPServer: string; // Reconnect to a specific MCP server
	cmdRefreshAutoRefreshModelsBankWideOrOneModelById: string; // Refresh auto-refresh models bank-wide, or one model by id
	cmdReloadAllPlugins: string; // Reload all plugins
	cmdReloadAllPluginsSkillsCommandsHooksToolsAgentsMCP: string; // Reload all plugins (skills, commands, hooks, tools, agents, MCP)
	cmdRemoveAMarketplaceSource: string; // Remove a marketplace source
	cmdRemoveAWorkspaceDirectoryFromThisSession: string; // Remove a workspace directory from this session
	cmdRemoveAnMCPServer: string; // Remove an MCP server
	cmdRemoveAnSSHHost: string; // Remove an SSH host
	cmdRemoveCachedSmitheryAPIKey: string; // Remove cached Smithery API key
	cmdRemoveOAuthAuthFromAServer: string; // Remove OAuth auth from a server
	cmdRemoveTaskPhaseAllFuzzyMatched: string; // Remove task/phase/all (fuzzy-matched)
	cmdRenameTheCurrentSession: string; // Rename the current session
	cmdRenderAScanOrSecurityResource: string; // Render a scan or security:// resource
	cmdReplaceTodosFromAMarkdownFileDefaultTODOMd: string; // Replace todos from a Markdown file (default: TODO.md)
	cmdResetProviderStreamStateWithoutChangingTheLocalTranscript: string; // Reset provider stream state without changing the local transcript
	cmdResumeADifferentSession: string; // Resume a different session
	cmdResumeAPausedGoal: string; // Resume a paused goal
	cmdRetryTheLastFailedAgentTurn: string; // Retry the last failed agent turn
	cmdReturnFullTranscriptAsPlainTextWithLLMRequestJSONPath: string; // Return full transcript as plain text, with LLM request JSON path
	cmdRunAFullBackgroundAgentOnTangentialWork: string; // Run a full background agent on tangential work
	cmdRunMemoryBackendDiagnostics: string; // Run memory backend diagnostics
	cmdSearchSmitheryRegistryAndDeployAnMCPServer: string; // Search Smithery registry and deploy an MCP server
	cmdSessionManagementCommands: string; // Session management commands
	cmdSetAFindingDispositionWithRationale: string; // Set a finding disposition with rationale
	cmdSetOrReplaceTheGoal: string; // Set or replace the goal
	cmdSetTheCLIDisplayLanguage: string; // Set the CLI display language
	cmdShakeHeavyContentOutOfTheConversationContext: string; // Shake heavy content out of the conversation context
	cmdShareAReadOnlyLinkGuestsCanWatchNotPrompt: string; // Share a read-only link (guests can watch, not prompt)
	cmdShareSessionViaAnEncryptedLinkShareServerOrSecretGist: string; // Share session via an encrypted link (share server or secret gist)
	cmdShareThisSessionLiveViaARelay: string; // Share this session live via a relay
	cmdShowAdvisorStatus: string; // Show advisor status
	cmdShowAllKeyboardShortcuts: string; // Show all keyboard shortcuts
	cmdShowAsyncBackgroundJobsStatus: string; // Show async background jobs status
	cmdShowAvailableTools: string; // Show available tools
	cmdShowBackgroundJobs: string; // Show background jobs
	cmdShowChangelog: string; // Show changelog
	cmdShowChangelogEntries: string; // Show changelog entries
	cmdShowCompleteChangelog: string; // Show complete changelog
	cmdShowComputerUseStatus: string; // Show computer use status
	cmdShowContextUsage: string; // Show context usage
	cmdShowCurrentGoalDetails: string; // Show current goal details
	cmdShowCurrentMemoryInjectionPayload: string; // Show current memory injection payload
	cmdShowCurrentModelSelection: string; // Show current model selection
	cmdShowEstimatedContextUsageBreakdown: string; // Show estimated context usage breakdown
	cmdShowFastModeStatus: string; // Show fast mode status
	cmdShowHelpMessage: string; // Show help message
	cmdShowInspectImageStatus: string; // Show inspect_image status
	cmdShowLinkParticipants: string; // Show link + participants
	cmdShowMemoryBackendStatistics: string; // Show memory backend statistics
	cmdShowNativeScanOperationStatus: string; // Show native scan operation status
	cmdShowNotificationCapabilitiesAndSubscriptions: string; // Show notification capabilities and subscriptions
	cmdShowOneMentalModelIdRequired: string; // Show one mental model (id required)
	cmdShowOrConfigureTheCurrentSession: string; // Show or configure the current session
	cmdShowProviderUsageAndLimits: string; // Show provider usage and limits
	cmdShowSessionInfoAndStats: string; // Show session info and stats
	cmdShowTokenUsage: string; // Show token usage
	cmdShowToolsCurrentlyVisibleToTheAgent: string; // Show tools currently visible to the agent
	cmdShowUsageGuide: string; // Show usage guide
	cmdSpendASavedCodexRateLimitReset: string; // Spend a saved Codex rate-limit reset
	cmdStartANewSession: string; // Start a new session
	cmdStartAPlannedOrNewlyPlannedNativeScan: string; // Start a planned or newly planned native scan
	cmdStartCodexBackedRealtimeVoiceMode: string; // Start Codex-backed realtime voice mode
	cmdStopSharing: string; // Stop sharing
	cmdStripImageBlocks: string; // Strip image blocks
	cmdStripToolResultsLargeBlocksDefault: string; // Strip tool results + large blocks (default)
	cmdSwitchModelForThisSession: string; // Switch model for this session
	cmdSwitchModelForThisSessionSameAsAltP: string; // Switch model for this session (same as alt+p)
	cmdSwitchToAFastCheapModelAtTheNextActionWorksEvenWithoutPrewalk: string; // Switch to a fast/cheap model at the next action (works even without --prewalk)
	cmdSwitchToHeadlessMode: string; // Switch to headless mode
	cmdSwitchToVisibleMode: string; // Switch to visible mode
	cmdTestConnectionToAServer: string; // Test connection to a server
	cmdToggleAdvisor: string; // Toggle advisor
	cmdToggleBrowserHeadlessVsVisibleMode: string; // Toggle browser headless vs visible mode
	cmdToggleComputerUse: string; // Toggle computer use
	cmdToggleFastMode: string; // Toggle fast mode
	cmdToggleGoalModePersistentAutonomousObjectiveForThisSession: string; // Toggle goal mode (persistent autonomous objective for this session)
	cmdTogglePlanModeAgentPlansBeforeExecuting: string; // Toggle plan mode (agent plans before executing)
	cmdTogglePriorityServiceTierOpenAIServiceTierPriorityAnthropicSpeedFast: string; // Toggle priority service tier (OpenAI service_tier=priority, Anthropic speed=fast)
	cmdToggleTheAdvisorASecondModelThatReviewsEachTurnAndInjectsNotes: string; // Toggle the advisor (a second model that reviews each turn and injects notes)
	cmdToggleTheNativeComputerUseToolForThisSession: string; // Toggle the native computer-use tool for this session
	cmdToggleVibeModeDirectPersistentFastGoodWorkerSessionsReadOnlyToolset: string; // Toggle vibe mode (direct persistent fast/good worker sessions; read-only toolset)
	cmdToggleVisionDelegation: string; // Toggle vision delegation
	cmdUninstallAPluginSelectorIfNoArgs: string; // Uninstall a plugin (selector if no args)
	cmdUpdateMarketplaceCatalogS: string; // Update marketplace catalog(s)
	cmdUpgradeOutdatedPlugins: string; // Upgrade outdated plugins
	cmdValidateOneFindingWithZetaTools: string; // Validate one finding with Zeta tools
	cmdViewAndManageInstalledPlugins: string; // View and manage installed plugins
	cmdViewOrModifyTheAgentSTodoList: string; // View or modify the agent's todo list
	cmdWriteTodosAsMarkdownToAFileDefaultTODOMd: string; // Write todos as Markdown to a file (default: TODO.md)

	// input & selector controller status texts
	statusImagePasteIsNotSupportedInThisPrompt: string; // Image paste is not supported in this prompt
	statusLocalExecutionIsHostOnlyDuringACollabSession: string; // Local execution is host-only during a collab session
	statusThisCollabLinkIsReadOnlyPromptingIsDisabled: string; // This collab link is read-only — prompting is disabled
	statusABashCommandIsAlreadyRunningPressEscToCancelItFirst: string; // A bash command is already running. Press Esc to cancel it first.
	statusAPythonExecutionIsAlreadyRunningPressEscToCancelItFirst: string; // A Python execution is already running. Press Esc to cancel it first.
	statusCommandsRunInTheMainSessionPressToReturnFirst: string; // Commands run in the main session — press ←← to return first
	statusSuspendCtrlZIsNotSupportedOnThisPlatform: string; // Suspend (Ctrl+Z) is not supported on this platform
	statusNoQueuedMessagesToRestore: string; // No queued messages to restore
	statusRetryIsHostOnlyDuringACollabSession: string; // /retry is host-only during a collab session
	statusNothingToRetry: string; // Nothing to retry
	statusUsageQueueMessageOrStartAPromptWith: string; // Usage: /queue <message> (or start a prompt with -> / =>)
	statusPastedPathIsNotASupportedImage: string; // Pasted path is not a supported image
	statusFailedToReadPastedImagePath: string; // Failed to read pasted image path
	statusClipboardIsEmpty: string; // Clipboard is empty
	statusFailedToReadClipboard: string; // Failed to read clipboard
	statusNoTextInClipboardToPasteRaw: string; // No text in clipboard to paste raw
	statusFailedToPasteRawTextFromClipboard: string; // Failed to paste raw text from clipboard
	statusFailedToSavePasteToAFilePastedInlineInstead: string; // Failed to save paste to a file — pasted inline instead
	statusNothingToCopy: string; // Nothing to copy
	statusFailedToCopyToClipboard: string; // Failed to copy to clipboard
	statusModelThinkingApplyToTheMainSessionPressToReturnFirst: string; // Model/thinking apply to the main session — press ←← to return first
	statusCurrentModelDoesNotSupportThinking: string; // Current model does not support thinking
	statusOnlyOneRoleModelAvailable: string; // Only one role model available
	statusThinkingIsOffEnableThinkingToShowBlocks: string; // Thinking is off — enable thinking to show blocks
	statusNoEditorConfiguredSetVISUALOrEDITOREnvironmentVariable: string; // No editor configured. Set $VISUAL or $EDITOR environment variable.
	mcpStatusLabel: string; // "Status:" row label
	statusNoMessagesToBranchFrom: string; // No messages to branch from
	statusBranchedToNewSession: string; // Branched to new session
	statusNothingToCopyYet: string; // Nothing to copy yet.
	statusNoEntriesInSession: string; // No entries in session
	statusAlreadyAtThisPoint: string; // Already at this point
	statusReAnswerCancelled: string; // Re-answer cancelled
	statusBranchSummarizationCancelled: string; // Branch summarization cancelled
	statusNavigationCancelled: string; // Navigation cancelled
	statusNavigatedToSelectedPoint: string; // Navigated to selected point
	statusAskToolUIIsNotReady: string; // Ask tool UI is not ready
	statusNoSessionFileToDeleteInMemorySession: string; // No session file to delete (in-memory session)
	statusSessionHasNotBeenSavedYet: string; // Session has not been saved yet
	statusDeleteCancelled: string; // Delete cancelled
	statusSessionDeleted: string; // Session deleted
	statusNoStoredProviderCredentialsToLogOutRemoveEnvOrConfigAuthAtItsSource: string; // No stored provider credentials to log out. Remove env or config auth at its source.
	statusCannotPinAnAccountWhileTheSessionIsStreaming: string; // Cannot pin an account while the session is streaming.
	statusLoadingProviderAccounts: string; // Loading provider accounts…
	statusSelectAModelBeforePinningAProviderAccount: string; // Select a model before pinning a provider account.
	statusCheckingSavedRateLimitResets: string; // Checking saved rate-limit resets…
	statusNoCodexAccountsFoundUseLoginToAddOne: string; // No Codex accounts found. Use /login to add one.
	statusWrapTheTextInAttachmentTagsCollapsedToAMarker: string; // Wrap the text in <attachment> tags, collapsed to a marker
	statusSaveTheTextToALocalPasteFile: string; // Save the text to a local://paste file
	statusCollapseTheTextToAnInlinePasteMarker: string; // Collapse the text to an inline paste marker
	statusEscToPasteInline: string; // Esc to paste inline
	statusQueuedMessageForAfterCompaction: string; // Queued message for after compaction
	statusSentQueuedMessage: string; // Sent queued message
	statusQueuedMessageForWhenTheAgentYields: string; // Queued message for when the agent yields

	mcpManualLoginTip: string; // Headless? Paste the redirect URL or code with /login <value>.
	mcpClickHereToAuthorize: string; // OSC 8 hyperlink label
	mcpOpenAuthorizationUrl: string; // OAuth banner line
	mcpCopyUrl: string; // Copy URL row label
	mcpLocalShortcutFmt: string; // Local shortcut row, %s = launch url
	mcpConnectingToFmt: string; // Connecting spinner line, %s = server name
	mcpOAuthFlowCancelled: string; // MCPOAuthCancelledError default message
	mcpNoManagerAvailable: string; // "No MCP manager available."
	mcpManagerNotAvailable: string; // "MCP manager not available."
	mcpUnknownSubcommandFmt: string; // Unknown /mcp subcommand, %s = subcommand
	mcpHelpTitle: string; // Help title
	mcpHelpIntro: string; // Help intro
	mcpHelpCommands: string; // Commands header
	mcpHelpAdd: string; // Help row
	mcpHelpAddUsage: string; // Help row
	mcpHelpList: string; // Help row
	mcpHelpRemove: string; // Help row
	mcpHelpTest: string; // Help row
	mcpHelpReauth: string; // Help row
	mcpHelpUnauth: string; // Help row
	mcpHelpEnable: string; // Help row
	mcpHelpDisable: string; // Help row
	mcpHelpSearchUsage: string; // Help row
	mcpHelpSearchDesc: string; // Help row
	mcpHelpLogin: string; // Help row
	mcpHelpLogout: string; // Help row
	mcpHelpReconnect: string; // Help row
	mcpHelpReload: string; // Help row
	mcpHelpResources: string; // Help row
	mcpHelpPrompts: string; // Help row
	mcpHelpNotifications: string; // Help row
	mcpHelpHelp: string; // Help row
	mcpMissingUrlValue: string; // Missing --url value
	mcpInvalidTransportValue: string; // Invalid --transport value
	mcpMissingTokenValue: string; // Missing --token value
	mcpUnknownOptionFmt: string; // Unknown option, %s = option
	mcpQuickAddNameRequired: string; // Quick add without a name
	mcpUrlOrCommandNotBoth: string; // Both --url and -- given
	mcpTokenRequiresUrl: string; // --token without --url
	mcpKeywordRequired: string; // smithery-search without keyword
	mcpInvalidScopeValue: string; // Invalid --scope value
	mcpMissingLimitValue: string; // Missing --limit value
	mcpInvalidLimitValue: string; // Invalid --limit value
	mcpAuthFailedForFmt: string; // Quick-add auth failed, %s = name, %s = error
	mcpOAuthEndpointsNotDiscoveredFmt: string; // Quick-add OAuth endpoints missing, %s = name (twice)
	mcpAddCancelledForFmt: string; // Quick-add cancelled, %s = name
	mcpOAuthFlowFailedForFmt: string; // Quick-add OAuth failed, %s = name, %s = error
	mcpInvalidOAuthUrlsFmt: string; // Invalid OAuth URLs, %s = auth url, %s = token url
	mcpOAuthLoginInProgressFmt: string; // OAuth login already in progress, %s = provider
	mcpOAuthRequiredBanner: string; // OAuth banner title
	mcpPreparingBrowserAuth: string; // Preparing browser authorization line
	mcpWaitingForAuth: string; // Waiting for authorization line
	mcpAttemptingOpenBrowser: string; // Attempting to open browser line
	mcpAlternativeIfBrowserNotOpen: string; // Alternative copy line
	mcpOAuthTimedOutMessage: string; // OAuth timeout message
	mcpAuthCompletedInBrowser: string; // Authorization completed line
	mcpOAuthFlowTimedOut: string; // OAuth timeout error
	mcpOAuthFailedCheckCredentials: string; // OAuth 403 error
	mcpOAuthCodeInvalid: string; // OAuth invalid_grant error
	mcpOAuthCannotConnect: string; // OAuth connect error
	mcpOAuthAuthFailedFmt: string; // OAuth fallback error, %s = error
	mcpOAuthFlowAborted: string; // Abort reason default
	mcpMcpRemoteProxyHintFmt: string; // mcp-remote proxy explanation, %s = http hint
	mcpStdioNoOAuthFmt: string; // stdio reauth explanation, %s = http hint
	mcpReauthNotRequired: string; // Server already works without auth
	mcpOAuthEndpointsNotFound: string; // No OAuth endpoints discovered
	mcpConnectionStillPending: string; // Internal connection wait message
	mcpConnectedToFmt: string; // Connected status, %s = name
	mcpStillConnectingFmt: string; // Still connecting status, %s = name
	mcpConnectionCheckCompleteFmt: string; // Suppressed warning status, %s = name
	mcpCouldNotConnectYetFmt: string; // Could not connect status, %s = name
	mcpAddedServerToFmt: string; // Server added, %s = name, %s = scope word
	mcpSuccessfullyConnected: string; // Success line
	mcpConnectingInBackground: string; // Connecting in background line
	mcpRunTestInSecondsFmt: string; // Run test hint, %s = name
	mcpAddedButNotConnected: string; // Added but not connected warning
	mcpRunTestToTestFmt: string; // Run test hint, %s = name
	mcpRunListToSee: string; // Run list hint
	mcpTipCheckPermissions: string; // EACCES tip
	mcpTipInsufficientDisk: string; // ENOSPC tip
	mcpTipUseList: string; // Already-exists tip
	mcpFailedToAddServerFmt: string; // Failed to add, %s = error
	mcpServerCreationCancelled: string; // Wizard cancelled line
	mcpTipEscCancel: string; // Cancel tip
	mcpNoServersConfigured: string; // Empty list line
	mcpUseAddToAdd: string; // Empty list hint
	mcpConfiguredServersTitle: string; // List title
	mcpUserLevel: string; // User level label
	mcpProjectLevel: string; // Project level label
	mcpStatusInactive: string; // Inactive status
	mcpStatusConnected: string; // Connected status
	mcpStatusConnecting: string; // Connecting status
	mcpStatusNotConnected: string; // Not connected status
	mcpStatusDisabled: string; // Disabled status
	mcpDisabledHeader: string; // Disabled header
	mcpDiscoveredSuffix: string; // Discovered servers suffix
	mcpFailedToListServersFmt: string; // Failed to list, %s = error
	mcpServerNotFoundInFmt: string; // Server not found, %s = name, %s = scope word
	mcpRemovedServerFromFmt: string; // Server removed, %s = name, %s = scope word
	mcpFailedToRemoveServerFmt: string; // Failed to remove, %s = error
	mcpServerNotFoundTipFmt: string; // Test: not found, %s = name
	mcpServerDisabledEnableFirstFmt: string; // Disabled server, %s = name (twice)
	mcpTestingConnectionFmt: string; // Testing line, %s = name
	mcpTestSuccessfullyConnectedFmt: string; // Test success, %s = name
	mcpTestServerFmt: string; // Server line, %s = name, %s = version
	mcpTestToolsFmt: string; // Tools line, %s = count
	mcpAvailableTools: string; // Available tools header
	mcpCancelledMCPTestFmt: string; // Test cancelled, %s = name
	mcpTipCheckCommand: string; // ENOENT tip
	mcpTipCheckFilePermissions: string; // EACCES tip
	mcpTipCheckServerRunning: string; // ECONNREFUSED tip
	mcpTipServerSlow: string; // Timeout tip
	mcpTipCheckCredentials: string; // 401/403 tip
	mcpFailedToConnectToFmt: string; // Failed to connect, %s = name, %s = error
	mcpServerNameRequiredFmt: string; // Name required, %s = enable/disable literal
	mcpServerNotFoundFmt: string; // Server not found, %s = name
	mcpServerAlreadyEnabledFmt: string; // Already enabled, %s = name
	mcpServerAlreadyDisabledFmt: string; // Already disabled, %s = name
	mcpStatusWordConnected: string; // Status word
	mcpStatusWordConnecting: string; // Status word
	mcpStatusWordNotConnected: string; // Status word
	mcpEnabledNameFmt: string; // Enabled line, %s = name
	mcpDisabledNameFmt: string; // Disabled line, %s = name
	mcpEnabledNameScopeFmt: string; // Enabled with scope, %s = name, %s = scope word
	mcpDisabledNameScopeFmt: string; // Disabled with scope, %s = name, %s = scope word
	mcpFailedToEnableServerFmt: string; // Failed to enable, %s = error
	mcpFailedToDisableServerFmt: string; // Failed to disable, %s = error
	mcpScopeWordUser: string; // Scope word inserted into config phrases
	mcpScopeWordProject: string; // Scope word inserted into config phrases
	mcpNoStoredOAuthFmt: string; // No stored auth, %s = name
	mcpClearedAuthForFmt: string; // Auth cleared, %s = name, %s = scope word
	mcpFailedToClearAuthFmt: string; // Failed to clear auth, %s = error
	mcpReauthorizingFmt: string; // Reauthorizing line, %s = name
	mcpReauthorizedFmt: string; // Reauthorized line, %s = name, %s = scope word
	mcpStateWordConnected: string; // Reauth status word
	mcpStateWordConnecting: string; // Reauth status word
	mcpStateWordNotConnected: string; // Reauth status word
	mcpReauthorizationCancelledFmt: string; // Reauth cancelled, %s = name
	mcpFailedToReauthorizeFmt: string; // Failed to reauthorize, %s = error
	mcpReloading: string; // Reloading line
	mcpReloadComplete: string; // Reload complete
	mcpConnectedServersFmt: string; // Connected count, %s = count
	mcpFailedToReloadFmt: string; // Failed to reload, %s = error
	mcpReconnectingToFmt: string; // Reconnecting line, %s = name
	mcpReconnectedToFmt: string; // Reconnected line, %s = name
	mcpReconnectFailedCheckStatusFmt: string; // Reconnect failed, %s = name
	mcpReconnectFailedFmt: string; // Reconnect failed with error, %s = name, %s = error
	mcpSomeServersFailedToConnect: string; // Connection errors header
	mcpResourcesTitle: string; // Resources title
	mcpTemplatesLabel: string; // Templates label
	mcpNoResourcesAvailable: string; // Empty resources
	mcpPromptsTitle: string; // Prompts title
	mcpNoPromptsAvailable: string; // Empty prompts
	mcpNotificationsTitle: string; // Notifications title
	mcpNotifEnabled: string; // Notifications enabled word
	mcpNotifDisabled: string; // Notifications disabled word
	mcpNotifSettingRef: string; // Setting reference
	mcpNotifSubscribedFmt: string; // Subscribed state, %s = count, %s = plural s
	mcpNotifNoSubscriptions: string; // No subscriptions
	mcpNotifInactive: string; // Inactive state
	mcpNotifNotSupported: string; // Not supported
	mcpNoServersSupportNotifications: string; // Empty notifications
	mcpSmitheryKeyCannotBeEmpty: string; // Empty API key
	mcpSmitheryKeyValidationFailedFmt: string; // Validation failed, %s = error
	mcpSmitheryApiKeyPrompt: string; // API key input label
	mcpSmitheryKeySaved: string; // Key saved status
	mcpSmitheryAuthTimedOut: string; // Poll timeout
	mcpSmitheryAuthFailed: string; // Poll error
	mcpSmitheryAuthCancelled: string; // Poll cancelled
	mcpSmitheryLoginTitle: string; // Login title
	mcpSmitheryBrowserAuthStarted: string; // Browser auth started
	mcpSmitheryAuthorizeUrl: string; // Authorize URL label
	mcpSmitheryFallbackFmt: string; // Fallback URL, %s = url
	mcpSmitheryAuthRequiredReasonFmt: string; // Auth required, %s = reason
	mcpSmitheryPasteApiKey: string; // Manual fallback hint
	mcpSmitheryBrowserFailedFmt: string; // Browser failed, %s = error
	mcpSmitheryRateLimited: string; // 429 reason
	mcpSmitheryForbidden: string; // 401/403 reason
	mcpSmitheryLoginCancelledRetry: string; // Login cancelled, retry hint
	mcpSmitheryKeyNotFoundAfterLogin: string; // Key missing after login
	mcpSmitheryLoginCancelled: string; // Login cancelled status
	mcpSmitheryKeyRemoved: string; // Key removed
	mcpNoCachedSmitheryKey: string; // No cached key
	mcpServerNameForDeployFmt: string; // Deploy name prompt, %s = default
	mcpServerNameCannotBeEmpty: string; // Empty deploy name
	mcpServerAlreadyExistsInFmt: string; // Name taken, %s = name, %s = scope word
	mcpRegistryInputRequiredFmt: string; // Required input label, %s = key
	mcpRegistryInputOptionalFmt: string; // Optional input label, %s = key
	mcpMissingRequiredValueFmt: string; // Missing required input, %s = key
	mcpRegistryResultsForFmt: string; // Registry picker title, %s = keyword
	mcpDeployCancelled: string; // Deploy cancelled
	mcpSearchingRegistryFmt: string; // Searching line, %s = keyword
	mcpNoResultsFoundFmt: string; // No results, %s = keyword
	mcpSelectionCancelled: string; // Selection cancelled
	mcpLoginFirstToAuthenticateFmt: string; // Auth-first hint, %s = message
	mcpSmitherySearchFailedFmt: string; // Search failed, %s = error
	mcpRequiredForSmitherySearch: string; // Reason for auth retry
	mcpWizardTitle: string; // Wizard title
	mcpStepNameTitle: string; // Step title
	mcpStepTransportTitle: string; // Step title
	mcpStepCommandTitle: string; // Step title
	mcpStepArgsTitle: string; // Step title
	mcpStepUrlTitle: string; // Step title
	mcpStepAuthMethodTitle: string; // Step title
	mcpStepAuthLocationTitle: string; // Step title
	mcpStepEnvVarTitle: string; // Step title
	mcpStepHeaderTitle: string; // Step title
	mcpStepScopeTitle: string; // Step title
	mcpConfirmTitle: string; // Confirm step title
	mcpOAuthAuthUrlTitle: string; // OAuth step title
	mcpOAuthTokenUrlTitle: string; // OAuth step title
	mcpOAuthClientIdTitle: string; // OAuth step title
	mcpOAuthClientSecretTitle: string; // OAuth step title
	mcpOAuthScopesTitle: string; // OAuth step title
	mcpApiKeyTitle: string; // API key step title
	mcpOAuthAuthFailedTitle: string; // OAuth error step title
	mcpWizardEnterUniqueName: string; // Name step prompt
	mcpWizardNameChars: string; // Name charset hint
	mcpWizardEnterContinueEscCancel: string; // Key hint
	mcpWizardSelectTransport: string; // Transport step prompt
	mcpWizardNavigateHint: string; // Key hint
	mcpWizardEnterCommand: string; // Command step prompt
	mcpWizardEnterContinueEscBack: string; // Key hint
	mcpWizardEnterArgs: string; // Args step prompt
	mcpWizardEnterSkipContinue: string; // Key hint
	mcpWizardEnterUrl: string; // URL step prompt
	mcpWizardUrlSchemeHint: string; // URL scheme hint
	mcpWizardEnterEnvVarName: string; // Env var prompt
	mcpWizardEnterHeaderName: string; // Header prompt
	mcpWizardNavigateSelectBackHint: string; // Key hint
	mcpWizardSaveConfig: string; // Confirm prompt
	mcpWizardYes: string; // Yes option
	mcpWizardNo: string; // No option
	mcpWizardEnterOAuthAuthEndpoint: string; // OAuth prompt
	mcpWizardEnterOAuthTokenEndpoint: string; // OAuth prompt
	mcpWizardEnterOAuthClientId: string; // OAuth prompt
	mcpWizardEnterOAuthClientSecret: string; // OAuth prompt
	mcpWizardPkceHint: string; // PKCE hint
	mcpWizardEnterOAuthScopes: string; // OAuth prompt
	mcpWizardChooseNextAction: string; // Error step prompt
	mcpWizardRetryOAuth: string; // Retry option
	mcpWizardEditOAuthSettings: string; // Edit option
	mcpWizardEnterApiKey: string; // API key prompt
	mcpWizardPwManagerHint: string; // Password manager hint
	mcpTransportStdio: string; // Transport option
	mcpTransportHttp: string; // Transport option
	mcpTransportSse: string; // Transport option
	mcpAuthOAuth: string; // Auth option
	mcpAuthOAuthDesc: string; // Auth option description
	mcpAuthManual: string; // Auth option
	mcpAuthManualDesc: string; // Auth option description
	mcpAuthLocationEnv: string; // Location option
	mcpAuthLocationHeader: string; // Location option
	mcpScopeUserLabelFmt: string; // Scope option, %s = path
	mcpScopeProjectLabelFmt: string; // Scope option, %s = path
	mcpConfirmNameFmt: string; // Summary row, %s = name
	mcpConfirmTypeFmt: string; // Summary row, %s = type
	mcpConfirmCommandFmt: string; // Summary row, %s = command
	mcpConfirmArgsFmt: string; // Summary row, %s = args
	mcpConfirmUrlFmt: string; // Summary row, %s = url
	mcpConfirmAuthNone: string; // Summary row
	mcpConfirmAuthOAuth: string; // Summary row
	mcpConfirmAuthEnvKeyFmt: string; // Summary row, %s = env var name
	mcpConfirmAuthHeaderKeyFmt: string; // Summary row, %s = header name
	mcpConfirmScopeFmt: string; // Summary row, %s = scope label
	mcpConnSuccess: string; // Test success
	mcpNoAuthRequired: string; // No auth needed
	mcpOAuthDetected: string; // OAuth detected
	mcpLaunchingBrowser: string; // Launching browser
	mcpAuthRequiredWarning: string; // Auth required warning
	mcpOAuthNotDiscovered: string; // OAuth params missing
	mcpProvideApiKeyManually: string; // Manual key fallback
	mcpConnFailed: string; // Connection failed
	mcpAddingServerAnyway: string; // Proceed anyway hint
	mcpUrlIsRequired: string; // URL validation error
	mcpInvalidUrlFormat: string; // URL validation error
	mcpUrlSchemeInvalid: string; // URL validation error
	mcpOAuthFlowNotAvailable: string; // No OAuth callback
	mcpOAuthConfigIncomplete: string; // Incomplete OAuth config
	mcpAuthTokenUrlsRequired: string; // Required URLs
	mcpPressEscToGoBack: string; // Key hint
	mcpOAuthAuthentication: string; // OAuth flow title
	mcpLaunchingOAuthFlow: string; // Launching OAuth line
	mcpBrowserWillOpen: string; // Browser hint
	mcpIfBrowserNotOpen: string; // Copy URL hint
	mcpPressEscToCancel: string; // Cancel hint
	mcpAuthSuccessful: string; // Auth success
	mcpRunningHealthCheck: string; // Health check line
	mcpCheckingServerConnectionFmt: string; // Health spinner, %s = frame
	mcpHealthCheckPassed: string; // Health passed
	mcpHealthCheckFailed: string; // Health failed
	mcpHealthCheckTimedOut: string; // Health timeout message
	mcpOAuthCancelledTitle: string; // Cancelled heading
	mcpTipRetryLaunchBrowser: string; // Cancel tip
	mcpTipCompleteFaster: string; // Timeout tip
	mcpTipCheckOAuthUrls: string; // URL tip
	mcpTipVerifyOAuthServer: string; // Connect tip
	mcpWizardRetry: string; // Retry option
	mcpExampleAuthUrl: string; // Example URL hint
	mcpExampleTokenUrl: string; // Example URL hint

	// session selector (resume picker)
	ssTitleResume: string; // Resume Session
	ssStatusDone: string; // done
	ssStatusInterrupted: string; // interrupted
	ssStatusAborted: string; // aborted
	ssStatusError: string; // error
	ssStatusPending: string; // pending
	ssNoSessionsFound: string; //   No sessions found
	ssNoSessionsInFolder: string; //   No sessions in current folder. Press Tab to view all.
	ssJustNow: string; // just now
	ssMinuteAgoFmt: string; // %s minute%s ago
	ssHourAgoFmt: string; // %s hour%s ago
	ssDayAgo: string; // 1 day ago
	ssDaysAgoFmt: string; // %s days ago
	ssForkLabel: string; // fork
	ssAllProjectsLabel: string; // all projects
	ssCurrentFolderLabel: string; // current folder
	ssLoadingAllProjects: string; //   Loading all projects…
	ssErrorPrefixFmt: string; // Error: %s
	ssDeleteSessionFmt: string; // Delete session?\n%s
	ssConfirmYes: string; // Yes
	ssConfirmNo: string; // No
	ssFooterHintFmt: string; //   [Del/⌫ delete · Enter select · Tab %s · Esc cancel]

	// compaction summary / handoff / branch dividers
	csLabelCompacted: string; // compacted
	csCompactedFromFmt: string; // **Compacted from %s tokens**
	csFramesAttachedFmt: string; // _%s snapcompact frame%s attached_
	csWarningFmt: string; // **Warning:** %s
	csLabelHandoff: string; // handed-off
	csHandoffContext: string; // **Handoff context**
	csNoHandoffContent: string; // _No handoff content._
	csLabelBranch: string; // branch
	csBranchSummary: string; // **Branch summary**

	// snapcompact shape preview
	scpHeaderFmt: string; //   Sample (zoomed) · %s · %s
	scpStatsFmt: string; // full frame %s×%s cells ≈ %s chars ≈ %s tokens
	scpAutoLabelFmt: string; // auto → %s
	scpNeedsKitty: string; // (graphic sample needs a Kitty-graphics terminal)
	scpRendering: string; //   rendering sample…
	scpRenderFailed: string; // (sample render failed)
	scpNeedsKittyPlaceholder: string; // (graphic sample needs Kitty unicode-placeholder graphics)

	// hook selector defaults
	hsHelpHint: string; // up/down navigate  enter select  esc cancel
	hsNoMatchingOptions: string; //   No matching options
	hsTypeToSearch: string; //   Type to search
	hsSearchFmt: string; //   Search: %s
	// command controller: status texts, reports, memory, usage panel
	ccUnknownError: string;
	ccUseDumpHint: string;
	ccSessionExportedToFmt: string;
	ccFailedToExportFmt: string;
	ccNoMessagesToDump: string;
	ccSessionCopiedToClipboard: string;
	ccLlmRequestJsonFmt: string;
	ccLlmRequestJsonUnavailableFmt: string;
	ccDumpSidecarNote: string;
	ccFailedToCopySessionFmt: string;
	ccDebugTranscriptFmt: string;
	ccFailedToWriteDebugTranscriptFmt: string;
	ccSharingSession: string;
	ccShareCancelled: string;
	ccShareUrlFmt: string;
	ccSessionShared: string;
	ccCustomShareFailedFmt: string;
	ccGistFmt: string;
	ccShareTrimmedNote: string;
	ccFailedToShareSessionFmt: string;
	ccAdvisorDisabled: string;
	ccAdvisorNotActive: string;
	ccAdvisorNoHistory: string;
	ccAdvisorHistoryCopied: string;
	ccFailedToCopyAdvisorHistoryFmt: string;
	ccAdvisorStatusRunning: string;
	ccAdvisorStatusPaused: string;
	ccAdvisorStatusNoModel: string;
	ccAdvisorStatusQuotaExhausted: string;
	ccAdvisorStatusError: string;
	ccAdvisorStatusTitle: string;
	ccAdvisorCountFmt: string;
	ccLabelModel: string;
	ccBgJobsUnavailable: string;
	ccBgJobsTitle: string;
	ccLabelRunning: string;
	ccNoAsyncJobsYet: string;
	ccRunningJobsTitle: string;
	ccRecentJobsTitle: string;
	ccJobStatusRunning: string;
	ccJobStatusCompleted: string;
	ccJobStatusCancelled: string;
	ccJobStatusFailed: string;
	ccUsageNotConfigured: string;
	ccFailedToFetchUsageFmt: string;
	ccNoUsageData: string;
	ccUsageTitle: string;
	ccNoChangelogEntries: string;
	ccFullChangelog: string;
	ccRecentChanges: string;
	ccChangelogHintUse: string;
	ccChangelogHintTail: string;
	ccKeyboardShortcuts: string;
	ccAvailableTools: string;
	ccContextUsageUnavailable: string;
	ccContextUsageTitle: string;
	ccMemoryPayloadEmpty: string;
	ccMemoryInjectionTitle: string;
	ccMemoryCleared: string;
	ccMemoryClearFailedFmt: string;
	ccMemoryConsolidationEnqueued: string;
	ccMemoryEnqueueFailedFmt: string;
	ccMemoryActionUnavailableFmt: string;
	ccMemoryStats: string;
	ccMemoryDiagnostics: string;
	ccMemoryPanelTitleFmt: string;
	ccMemoryFailedFmt: string;
	ccMemoryUsage: string;
	ccHindsightNotActive: string;
	ccMentalModelsDisabled: string;
	ccMmShowUsage: string;
	ccMmHistoryUsage: string;
	ccMmDeleteUsage: string;
	ccMmUsage: string;
	ccNoMentalModelsOnBankFmt: string;
	ccMentalModelsTitleFmt: string;
	ccMmListFailedFmt: string;
	ccMentalModelNotFoundFmt: string;
	ccTagsLineFmt: string;
	ccLastRefreshedLineFmt: string;
	ccSourceQueryFmt: string;
	ccEmptyModelContent: string;
	ccModelIdFmt: string;
	ccMmShowFailedFmt: string;
	ccRefreshQueuedForFmt: string;
	ccRefreshFailedForFmt: string;
	ccNoAutoRefreshModelsFmt: string;
	ccSkippedCuratedFmt: string;
	ccRefreshQueuedCountFmt: string;
	ccMmRefreshFailedFmt: string;
	ccNoHistoryForFmt: string;
	ccHistoryTitleFmt: string;
	ccMmHistoryFailedFmt: string;
	ccNoSeedsForScopeFmt: string;
	ccSeedFailedForFmt: string;
	ccSeededCountFmt: string;
	ccMmSeedFailedFmt: string;
	ccCacheReloaded: string;
	ccReloadFailed: string;
	ccDeletedFromBankFmt: string;
	ccMmDeleteFailedFmt: string;
	ccSessionInfoTitle: string;
	ccInMemory: string;
	ccLabelFile: string;
	ccLabelId: string;
	ccNoModelSelected: string;
	ccProviderTitle: string;
	ccMessagesTitle: string;
	ccLabelUser: string;
	ccLabelAssistant: string;
	ccLabelToolCalls: string;
	ccLabelToolResults: string;
	ccLabelTotal: string;
	ccActive: string;
	ccInactive: string;
	ccLabelAppendOnly: string;
	ccSettingLabel: string;
	ccTokensTitle: string;
	ccLabelInput: string;
	ccLabelOutput: string;
	ccLabelCacheRead: string;
	ccLabelCacheWrite: string;
	ccCostTitle: string;
	ccLabelPremiumRequests: string;
	ccLspServersTitle: string;
	ccLspStatusReady: string;
	ccLspStatusAvailable: string;
	ccLspStatusConnecting: string;
	ccLspStatusError: string;
	ccMcpServersTitle: string;
	ccNoneConnected: string;
	ccConnected: string;
	ccToolsCountFmt: string;
	ccLabelContext: string;
	ccLabelMessages: string;
	ccLabelSpend: string;
	ccTotalsTitle: string;
	ccLabelTokens: string;
	ccLabelCost: string;
	ccQuotaTitle: string;
	ccSpendTitle: string;
	ccNewSessionStarted: string;
	ccWaitForResponseRefresh: string;
	ccProviderState: string;
	ccProviderStates: string;
	ccFreshProviderSessionFmt: string;
	ccNothingToDrop: string;
	ccSessionDropped: string;
	ccWaitForResponseFork: string;
	ccForkFailed: string;
	ccNewSession: string;
	ccSessionForkedToFmt: string;
	ccWaitForResponseMove: string;
	ccMoveUsage: string;
	ccCreateDirectory: string;
	ccFailedToCreateDirFmt: string;
	ccFailedToSaveSettingsFmt: string;
	ccMoveFailedFmt: string;
	ccMovedToFmt: string;
	ccSessionNameEmpty: string;
	ccRenameFailedFmt: string;
	ccWaitForResponseCd: string;
	ccBashCwdFailedFmt: string;
	ccBashFailedFmt: string;
	ccPythonFailedFmt: string;
	ccNothingToCompact: string;
	ccShakeFailedFmt: string;
	ccNothingToShake: string;
	ccCompactingContext: string;
	ccAutoCompactingContext: string;
	ccCompactionCancelled: string;
	ccCompactionFailedFmt: string;
	ccWaitForResponseHandoff: string;
	ccNothingToHandoff: string;
	ccGeneratingHandoff: string;
	ccHandoffCancelled: string;
	ccHandoffSavedFmt: string;
	ccHandoffFailedFmt: string;
	ccNewSessionWithHandoff: string;
	ccAuthModeApiKey: string;
	ccAuthModeEnvApiKey: string;
	ccAuthModeRuntimeFallback: string;
	ccAuthModeUnknown: string;
	ccLabelName: string;
	ccAccountIndexFmt: string;
	ccAccountFallback: string;
	ccFreePctFmt: string;
	ccAcctSingularFmt: string;
	ccAcctPluralFmt: string;
	ccResetsVerb: string;
	ccResetRangeFmt: string;
	ccPctUsedFmt: string;
	ccQuotaLineFmt: string;
	ccUsedFmt: string;
	ccAgoSuffixFmt: string;
	ccInUseBySession: string;
	ccModelsWithUsageData: string;
	ccSavedResetsRowFmt: string;
	ccActiveSuffix: string;
	ccExpiresInFmt: string;
	ccExpiredFmt: string;
	ccSavedRateLimitResets: string;
	ccUsageResetHint: string;
	ccNoLimitsLabel: string;
	ccContextTitle: string; // Context header
	ccCannotCreateDirFmt: string; // Cannot create dir, %s = basename
	ccCreateDirectoryConfirmFmt: string; // Create dir confirm, %s = path
	ccSessionRenamedToFmt: string; // Rename status, %s = name
	// interactive mode: loop mode, plan/goal/vibe modes, plan review, shutdown, LSP, speech
	imWorkingLabel: string;
	imSubagentsHeader: string;
	imMoreRunningFmt: string;
	imHookCommandDescription: string;
	imLoopModeDisabled: string;
	imLoopTimeLimitReachedFmt: string;
	imLoopResetRequiresVibeExitFmt: string;
	imLoopLimitReachedFmt: string;
	imLoopEnabledFmt: string;
	imLoopLimitedToFmt: string;
	imLoopRemainingFmt: string;
	imLoopTailRepeating: string;
	imLoopTailPrompted: string;
	imLoopEscSuffix: string;
	imLoopIterationOne: string;
	imLoopIterationMany: string;
	imLoopIterationsRemainingFmt: string;
	imLoopIterationsRemainingOneFmt: string;
	imLoopHourOne: string;
	imLoopHourMany: string;
	imLoopMinuteOne: string;
	imLoopMinuteMany: string;
	imLoopSecondOne: string;
	imLoopSecondMany: string;
	imLoopDurationLimitFmt: string;
	imLoopCommandDesc: string;
	imLoopOffLabel: string;
	imLoopPausedLabel: string;
	imLoopOnFmt: string;
	imLoopOnRepeatingLabel: string;
	imLoopOnWaitingLabel: string;
	imExitGoalModeFirst: string;
	imExitVibeModeFirst: string;
	imExitPlanModeFirst: string;
	imPlanModeEnabledFmt: string;
	imPlanModePaused: string;
	imPlanModeDisabled: string;
	imPlanModeDisabledSetting: string;
	imExitPlanModeTitle: string;
	imExitPlanModeBody: string;
	imPlanModeNotActive: string;
	imNoPlanToReviewFmt: string;
	imPlanFileNotFoundFmt: string;
	imOpenEditorFailedFmt: string;
	imNoEditorConfigured: string;
	imPlanUpdatedInEditor: string;
	imCopiedPlanToClipboard: string;
	imCopyPlanFailedFmt: string;
	imApproveKeepContext: string;
	imApproveKeepContextFmt: string;
	imContinuingWithFmt: string;
	imModelSwitchFailedFmt: string;
	imSliderCaption: string;
	imPlanReviewHelpText: string;
	imPlanReviewTitle: string;
	imPlanApproveExecute: string;
	imPlanApproveCompact: string;
	imPlanRefine: string;
	imRefinePromptHint: string;
	imRefineFailedFmt: string;
	imFinalizePlanFailedFmt: string;
	imGoalModeEnabled: string;
	imGoalModeResumed: string;
	imGoalModeCompleted: string;
	imGoalDropped: string;
	imGoalModePaused: string;
	imGoalModeDisabled: string;
	imGoalModeDisabledSetting: string;
	imGoalAlreadyActiveFmt: string;
	imResumeOrDropGoalFirst: string;
	imGoalObjectiveEditorTitle: string;
	imNoActiveGoal: string;
	imGoalAlreadyComplete: string;
	imGoalBudgetInvalidFmt: string;
	imGoalBudgetCleared: string;
	imGoalBudgetSetFmt: string;
	imResumeGoalBeforeBudget: string;
	imGoalBudgetEditorTitle: string;
	imNoGoalSet: string;
	imGoalMenuTitleFmt: string;
	imGoalMenuPausedTitleFmt: string;
	imGoalMenuShowDetails: string;
	imGoalMenuAdjustBudget: string;
	imGoalMenuPause: string;
	imGoalMenuResume: string;
	imGoalMenuDrop: string;
	imGoalDetailObjectiveFmt: string;
	imGoalDetailStatusFmt: string;
	imGoalDetailPausedSuffix: string;
	imGoalDetailTokensFmt: string;
	imGoalDetailTimeFmt: string;
	imGoalBudgetLineFmt: string;
	imGoalBudgetNoBudgetFmt: string;
	imNoActiveGoalToPause: string;
	imNoPausedGoalToResume: string;
	imNoGoalToDrop: string;
	imDropGoalTitle: string;
	imDropGoalBody: string;
	imVibeModeDisabled: string;
	imVibeModeDisabledKilledFmt: string;
	imClosingSession: string;
	imStillClosingFmt: string;
	imResumeHintFmt: string;
	imLspStartupFailedFmt: string;
	imLspStartupFailedForFmt: string;
	imLspStartupFailedForNamesFmt: string;
	imEndLiveModeFirst: string;
	imSttDisabledFmt: string;
	imFinishSttFirst: string;
	imSettingsSaveFailedFmt: string;
	imBtwBranchCancelled: string;
	imBtwBranchedFmt: string;
	imBtwBranched: string;
	imBtwBranchFailedFmt: string;
	imVibeModeEnabledDesc: string;
	// read tool group previews
	rtgReadTitleFmt: string;
	rtgReadTitle: string;
	rtgCorrectedFromFmt: string;
	rtgConflictsFmt: string;
	// ACP mode: auth, errors, plan approval, reserve confirmation
	acpThemeChangesUnavailable: string;
	acpAuthLocalCredentialsName: string;
	acpAuthLocalCredentialsDesc: string;
	acpAuthTerminalName: string;
	acpAuthTerminalDesc: string;
	acpErrUnknownAuthMethodFmt: string;
	acpErrUnsupportedBooleanOptionFmt: string;
	acpErrUnknownConfigOptionFmt: string;
	acpErrCwdRequired: string;
	acpErrUnknownExtMethodFmt: string;
	acpErrSessionNotFoundFmt: string;
	acpErrForkCancelledFmt: string;
	acpErrForkFailedFmt: string;
	acpErrLoadCancelledFmt: string;
	acpErrUnsupportedSessionFmt: string;
	acpErrCwdMismatchFmt: string;
	acpErrForkWhilePromptFmt: string;
	acpErrForkBeforePersistFmt: string;
	acpErrCwdAbsoluteFmt: string;
	acpAudioOmitted: string;
	acpErrUnknownModelFmt: string;
	acpErrUnknownThinkingFmt: string;
	acpModeDefaultName: string;
	acpModeDefaultDesc: string;
	acpModePlanName: string;
	acpModePlanDesc: string;
	acpErrUnsupportedModeFmt: string;
	acpPlanApproveMessageFmt: string;
	acpErrInvalidCursorFmt: string;
	acpReserveMargin: string;
	acpReservePercentFmt: string;
	acpReserveTitle: string;
	acpReserveBodyFmt: string;
	acpProviderName: string;
	acpErrUnsupportedTransportFmt: string;
	acpErrClosedBeforeQueued: string;
	acpErrDisposedBeforeQueued: string;
	acpErrCancelCleanupTimedOut: string;
	acpModeStderrBanner: string;
	acpModeStderrSpawnHint: string;
	acpModeStderrWaitHint: string;
	acpSkillRunFmt: string;
	acpExtensionCommandDesc: string;

	sshTitle: string;
	sshHelpIntro: string;
	sshHelpCommands: string;
	sshHelpAddUsage: string;
	sshHelpListRow: string;
	sshHelpRemoveRow: string;
	sshHelpHelpRow: string;
	sshErrUnknownSubcommandFmt: string;
	sshErrMissingHost: string;
	sshErrMissingUser: string;
	sshErrMissingPort: string;
	sshErrInvalidPort: string;
	sshErrMissingKey: string;
	sshErrMissingDesc: string;
	sshErrHostNameRequired: string;
	sshErrHostRequired: string;
	sshAddedFmt: string;
	sshListHintFmt: string;
	sshTipAlreadyExistsFmt: string;
	sshNoHosts: string;
	sshAddHintFmt: string;
	sshListTitle: string;
	sshUserLevel: string;
	sshUserLevelPath: string;
	sshProjectLevel: string;
	sshProjectLevelPath: string;
	sshDiscovered: string;
	sshDiscoveredFmt: string;
	sshDiscoveredReadOnly: string;
	sshErrRemoveNameRequired: string;
	sshRemovedFmt: string;
	omfgErrMissingJson: string;
	omfgErrNameChars: string;
	omfgErrNoCondition: string;
	omfgErrNoValidCondition: string;
	omfgErrNotObject: string;
	omfgErrEmptyName: string;
	omfgErrEmptyDescription: string;
	omfgErrNoScope: string;
	omfgErrEmptyBody: string;
	omfgLabelAssistantText: string;
	omfgLabelAssistantThinking: string;
	omfgFeedbackRejected: string;
	omfgNoSurfaces: string;
	omfgCheckedSurfaces: string;
	omfgFixScopeHint: string;
	omfgProblemTextScope: string;
	omfgScopeBroaderFmt: string;
	omfgConditionMatchedFmt: string;

	ssSaveHint: string;
	ssPreview: string;
	ssSelectHint: string;
	ssOrderedToggleHint: string;
	ssToggleHint: string;
	ssMaxInFlightTitle: string;
	ssLimitsHelp: string;
	ssClearAll: string;
	ssClearAllDesc: string;
	ssEditProviderHint: string;
	ssLimitHelp: string;
	ssErrLimitPositive: string;
	ssSearchHint: string;
	ssCloseHint: string;
	ssNavSectionsHint: string;
	ssNavTabsHint: string;
	ssMatchesOne: string;
	ssMatchesFmt: string;
	ssNoMatching: string;
	ssPreviewUnavailable: string;
	tselFilterNoTools: string;
	tselFilterUser: string;
	tselFilterLabeled: string;
	tselFilterAll: string;
	tselNoEntries: string;
	tselNoMatchFmt: string;
	tselPressBackspaceHint: string;
	tselPressAltHint: string;
	tselRoleUser: string;
	tselRoleDeveloper: string;
	tselRoleAssistant: string;
	tselAborted: string;
	tselNoContent: string;
	tselTool: string;
	tselCleared: string;
	tselSearchLabel: string;
	tselLabelPrompt: string;
	tselLabelHint: string;
	tselTitle: string;
	tselHelpHint: string;

	adToolsDefault: string;
	adTitleFmt: string;
	adUnsaved: string;
	adEnd: string;
	adSharedInstructions: string;
	adNone: string;
	adAddHelp: string;
	adWriteHelp: string;
	adCloseHelp: string;
	adRoleDefault: string;
	adNoTools: string;
	adOff: string;
	adOn: string;
	adModelLabel: string;
	adToolsLabel: string;
	adInstructionsLabel: string;
	adUsageLabel: string;
	adTokensFmt: string;
	adUnnamed: string;
	adAddItem: string;
	adSaveApply: string;
	adCloseItem: string;
	adListHint: string;
	adUnsavedNotify: string;
	adNameLabel: string;
	adModelFieldLabel: string;
	adResetModel: string;
	adToolsFieldLabel: string;
	adInstructionsFieldLabel: string;
	adDeleteAdvisor: string;
	adBack: string;
	adEditingFmt: string;
	adModelDefaultThinking: string;
	adDone: string;
	adToolsHint: string;
	adSharedTitle: string;
	psTitle: string;
	psNoPlugins: string;
	psInstallNpmHint: string;
	psInstallMarketplaceHint: string;
	psConfigHint: string;
	psBadgeNpm: string;
	psBadgeMarketplace: string;
	psToggleDesc: string;
	psNotSet: string;
	psEditHint: string;
	psMarketToggleDesc: string;
	psUnknown: string;
	psVersionFmt: string;
	psInstallPathFmt: string;
	psInstalledAtFmt: string;
	psLastUpdatedFmt: string;
	psToggleHint: string;
	psSelectHint: string;
	psSaveHint: string;

	mhAllModels: string;
	mhJustNow: string;
	mhNoRecent: string;
	mhUsingCached: string;
	mhCachedAgeFmt: string;
	mhUnavailable: string;
	mhNeedsAuth: string;
	mhNotRefreshed: string;
	mhZeroModels: string;
	mhRetryFallbackChip: string;
	mhProjectChip: string;
	mhGlobalChip: string;
	mhNewFallbackChainHint: string;
	mhAddingFallback: string;
	mhReplacingFallback: string;
	mhModelsScopeSuffix: string;
	mhRolesText: string;
	mhEnvHintFmt: string;
	mhOr: string;
	mhApiKeyHint: string;
	mhCreateHint: string;
	mhRoleStripHint: string;
	mhScopeStripHint: string;
	mhThinkingStripHint: string;
	mhPickFallbackHint: string;
	mhPickProtectedHint: string;
	mhAssignHint: string;
	mhScopeNavHint: string;
	mhRolesHint: string;
	mhChainHint: string;
	mhNewChainHint: string;
	mhRowsHint: string;
	mhOauthHint: string;
	mhProvidersHint: string;
	mhScopeToModels: string;
	mhScopeToProviders: string;
	mhRefreshSuffix: string;
	mhNewRoleName: string;
	mhRoleNameChars: string;
	adshNavHint: string;
	adshSessionModel: string;
	adshErrNotJson: string;
	adshErrMissingFields: string;
	adshErrIdentifier: string;
	adshErrWhenToUse: string;
	adshErrSystemPromptEmpty: string;
	adshSearchPrefix: string;
	adshTypeToFilter: string;
	adshNoAgents: string;
	adshOverride: string;
	adshSelectAgent: string;
	adshInspectSettings: string;
	adshStatus: string;
	adshSource: string;
	adshDefaultPattern: string;
	adshDefaultResolves: string;
	adshOverrideLabel: string;
	adshEffectivePattern: string;
	adshEffective: string;
	adshPrewalk: string;
	adshPath: string;
	adshDescription: string;
	adshOff: string;
	adshOn: string;
	adshOverrideSuffix: string;
	adshAgentDefaultSuffix: string;
	adshAgentDefault: string;
	adshUnresolved: string;
	adshNone: string;
	adshErrDescription: string;
	adshErrRegistry: string;
	adshErrNoModel: string;
	adshErrNoResponse: string;
	adshCreateTitle: string;
	adshCreatePrompt: string;
	adshGenerating: string;
	adshGeneratingShort: string;
	adshCreateHint: string;
	adshReviewTitle: string;
	adshWhenToUse: string;
	adshSystemPromptPreview: string;
	adshReviewHint: string;
	adshControlTitle: string;
	adshLoading: string;
	adshModelPatternPrompt: string;
	adshPreviewEffective: string;
	adshSuggestions: string;
	adshSaveHint: string;
	adshSourceProject: string;
	adshSourceUser: string;
	adshSourceBundled: string;

	ecEscToCancel: string;
	ecReasonOverflow: string;
	ecReasonIncomplete: string;
	ecReasonIdle: string;
	ecActionHandoff: string;
	ecActionShake: string;
	ecActionSnapcompact: string;
	ecActionMaintenance: string;
	ecHandoffCancelled: string;
	ecShakeCancelled: string;
	ecSnapCancelled: string;
	ecMaintenanceCancelled: string;
	ecShakeCompleted: string;
	ecHandoffCompleted: string;
	ecSnapFailed: string;
	ecMaintenanceFailed: string;
	ecRetryFailedFmt: string;
	ecStoppedWithError: string;
	ecTodoUpdateFailedPrefix: string;
	ecTodoUpdateFailedSuffix: string;
	tdUsageTitle: string;
	tdHelpShow: string;
	tdHelpEdit: string;
	tdHelpCopy: string;
	tdHelpExport: string;
	tdHelpImport: string;
	tdHelpAppend: string;
	tdHelpStart: string;
	tdHelpDone: string;
	tdHelpDrop: string;
	tdHelpRm: string;
	tdNoTodos: string;
	tdNoTodosCopy: string;
	tdCopied: string;
	tdNoTodosExport: string;
	tdAppendUsage: string;
	tdStartUsage: string;
	tdRmAll: string;
	tdClearedAll: string;
	tdNoEditor: string;
	tdEditorNoSave: string;
	smUserLevel: string;
	smProjectLevel: string;
	smExtensionModules: string;
	smMcpServers: string;
	smContextFiles: string;
	smSlashCommands: string;
	slDetached: string;
	slAgent: string;
	slAgents: string;

	agsChooseScope: string;
	cfgValidCommands: string;
	cfgInvalidValue: string;
	ftInvalidMaxTime: string;
	ftUnknownToolsFmt: string;
	ftPluralS: string;
	fpFileNotFoundFmt: string;
	xdgUnsupported: string;
	xdgEnsure: string;
	xdgAreSet: string;
	abkLoginUsage: string;
	abkLoginCancelled: string;
	abkNoProviders: string;
	abkSshNotFound: string;
	abkMissingTokens: string;
	abkNoIdentity: string;
	abkExpired: string;
	abkDisabled: string;
	abkApiKey: string;
	abkMigrateSource: string;
	abkNoSnapshot: string;
	abkSentinelReason: string;
	abkOauthSkipped: string;
	abkAlreadyOnBroker: string;
	abkAnotherApiKeyPlanned: string;
	abkAlreadyApiKey: string;
	abkSqliteSupplied: string;
	abkLoggedOut: string;
	agwNoInitialSnapshot: string;
	agwPluralS: string;
	agwNoIdentityOnCredential: string;

	askOtherOption: string;
	askChatOption: string;
	askNext: string;
	askRecommendedSuffix: string;
	askNavHint: string;
	askErrRequiresInteractive: string;
	askCancelled: string;
	askErrCountMismatch: string;
	askErrOrderMismatch: string;
	askInputCancelled: string;
	askErrIndex: string;
	askNote: string;
	askCancelledLabel: string;
	askErrNoQuestion: string;
	askAutoSelected: string;
	askNavHintSimple: string;
	askAutoSuffix: string;
	askCancelledMarker: string;
	askNoteAddedFmt: string;
	askCancelledSelection: string;
	aedLabel: string;
	aedSummary: string;
	aedErrNoOps: string;
	aedLimitReached: string;
	aedZeroReplacements: string;
	aedLimitNarrowPath: string;
	aedChangeNoun: string;
	aedReplacementNoun: string;
	aedFileNoun: string;
	tLimitReached: string;
	agrpLabel: string;
	agrpSummary: string;
	agrpErrNoPat: string;
	agrpErrSkip: string;
	agrpNoMatchesHelp: string;
	agrpLimitReached: string;
	agrpZeroMatches: string;
	agrpNoMatches: string;
	agrpMisScoped: string;
	agrpLimitNarrowPath: string;
	agrpMatchNoun: string;
	agrpFileNoun: string;
	apprBlockedFmt: string;
	apprOriginMcp: string;
	biExit0: string;
	biExited: string;
	biConsole: string;
	biEsc: string;
	biForceKill: string;
	biInputForwarded: string;
	biSessionFinished: string;
	rdErrHashlineSnapshot: string;
	rdErrPdfExtract: string;
	rdNoPdfImageMembers: string;
	rdPdfImageMembers: string;
	rdPdfMemberItem: string;
	rdErrPdfMemberNotFound: string;
	rdErrImageTooLarge: string;
	rdErrPdfMemberUnsupported: string;
	rdErrImageFormat: string;
	rdErrArchivePathNotFound: string;
	rdErrArchiveMultiRange: string;
	rdErrSqliteSelector: string;
	rdErrUrlDisabled: string;
	rdErrPathIsDirectory: string;
	rdErrPathNotFound: string;
	rdErrDirMultiRange: string;
	rdCannotReadExt: string;
	rdConversionFailed: string;
	rdErrQueryWithSelectors: string;
	rdErrXdevNotMounted: string;
	rdErrReadDirectory: string;
	rdConflictWildcard: string;
	rdElisionFooter: string;
	rdUnknownError: string;
	rdNone: string;
	rdImageMetadata: string;
	rdMimeFmt: string;
	rdBytesFmt: string;
	rdDimensionsFmt: string;
	rdDimensionsUnknown: string;
	rdChannelsFmt: string;
	rdChannelsUnknown: string;
	rdAlphaYes: string;
	rdAlphaNo: string;
	rdAlphaUnknown: string;
	rdInspectImageHint: string;
	wrExecutableNotice: string;
	wrErrSelectorListMisfire: string;
	wrErrSelectorListMisfireHint: string;
	wrErrArchivePathFile: string;
	wrErrArchivePathNotDir: string;
	wrErrArchiveDotDot: string;
	wrErrSqliteQueryParams: string;
	wrErrSqliteTable: string;
	wrErrSqliteRowKey: string;
	wrErrSqliteDeleteRowKey: string;
	wrErrSqliteJsonObject: string;
	wrErrBulkUnknownIds: string;
	wrErrFileNoLongerExists: string;
	gpErrInvalidSelector: string;
	gpErrOnlyLineRanges: string;
	gpErrLineRangeNeedsFile: string;
	gpErrEmptyPattern: string;
	gpErrNegativeSkip: string;
	gpErrInvalidRegex: string;
	gpMultipathStatHint: string;
	gpNoMatches: string;
	gpNoMoreResultsFmt: string;
	gpSkippedMissingFmt: string;
	gpOversizedNoteFmt: string;
	gpInLabelFmt: string;
	gpSkippedUnreadableFmt: string;
	ghErrLimitPositive: string;
	ghErrTailPositive: string;
	ghErrDateBoundEmpty: string;
	ghErrQueryRequired: string;
	ghErrRepoUnavailable: string;
	ghErrBranchUnavailable: string;
	ghErrHeadUnavailable: string;
	ghErrOriginUnavailable: string;
	ghErrRunInvalid: string;
	ghErrRunNoId: string;
	ghErrRunRepoMismatch: string;
	ghErrPathRepoRelative: string;
	ghErrNoPrNumber: string;
	ghErrTitleRequired: string;
	ghErrFillExclusive: string;
	ghErrSearchCodeDates: string;
	ghJobsTitle: string;
	ghNoJobsReported: string;
	ghFullLogUnavailable: string;
	ghLogTailUnavailable: string;
	ghFailuresDetected: string;
	ghAllJobsPassed: string;
	ghNoSuccessfulJobLogs: string;
	ghWaitingForRuns: string;
	ghRunsFailed: string;
	ghRunsPassed: string;
	ghRunsIncomplete: string;
	ghNoReviewCommentBody: string;
	ghNoDescription: string;
	ghUntitled: string;
	ghNoCodeMatches: string;
	ghNoReposFound: string;
	ghUnknownRepository: string;
	ghNoCommitMessage: string;
	ghMatchLabel: string;
	ghMaintainerCanModify: string;
	ghReusedPrWorktree: string;
	ghCreatedPrWorktree: string;
	ghPrWorktreeTitle: string;
	ghCheckedOutPrTitle: string;
	ghPushedPrBranchTitle: string;
	ghFailedSection: string;
	ghFailedJobsTitle: string;
	ghCannotInferWatchCommit: string;
	ghNotAGitHubRepository: string;
	ghFailedJobLogsLabel: string;
	ghItemTitleFmt: string;
	ghRepoItemFmt: string;
	ftErrCannotSearchUrl: string;
	ftErrUrlDisabled: string;
	ftInternalProtocolUrl: string;
	ftBinaryFetchFailedFmt: string;
	ftBinaryFetchFailed: string;
	ftFetchFailedFmt: string;
	ftFetchFailed: string;
	ftFetchedImageBinary: string;
	ftConvertedWithMarkit: string;
	ftExtractMainContent: string;
	glErrEmptyPath: string;
	glErrLimitPositive: string;
	glNoFilesFound: string;
	glUnknownError: string;
	glCaptionMultiTargets: string;
	glCaptionGitignored: string;
	glCaptionDirs: string;
	lnLessonStored: string;
	lnLessonQueued: string;
	lnErrMnemopiNotInit: string;
	lnErrMnemopiNoId: string;
	lnErrEmptyLesson: string;
	lnErrHindsightNotInit: string;
	lnDidNotCreateSkillFmt: string;
	lnManagedSkillFmt: string;
	lnVerbCreated: string;
	lnVerbUpdated: string;
	tdErrMissingContent: string;
	tdErrMissingPhase: string;
	tdErrMissingInitList: string;
	tdErrDuplicatePhaseFmt: string;
	tdEmptyListHint: string;
	ckErrAlreadyActive: string;
	ckCreated: string;
	ckRewindHint: string;
	ckErrNoActive: string;
	ckErrReportEmpty: string;
	ckRewindRequested: string;
	ckReportCaptured: string;
	rsProposeTitle: string;
	rsRejectTitle: string;
	rsResolveTitle: string;
	rsAppliedLabel: string;
	rsRejectedLabel: string;
	rsPendingAction: string;
	rsNoReason: string;
	meErrMnemopiNotInit: string;
	meErrHindsightNotInit: string;
	meNoMemoriesFound: string;
	meRecallFmt: string;
	meMemoryNoun: string;
	meMemoriesNoun: string;
	meNoInfoToReflect: string;
	meReflectFmt: string;
	meStoredFmt: string;
	meQueuedFmt: string;
	meAdditionalContext: string;
	meEditNotFoundFmt: string;
	meEditReadonlyFmt: string;
	meEditStatusFmt: string;
	meInBankFmt: string;
	meStoreSuffixFmt: string;
	plErrRenameNotAllowed: string;
	plErrDeleteNotAllowed: string;
	ydNoSchemaProvided: string;
	ydUnserializableSchema: string;
	ydErrTypeInvalid: string;
	ydErrUnresolvedRef: string;
	ydErrSchemaInvalid: string;
	ydErrDataAndError: string;
	ydErrDataRequired: string;
	ydResultSubmitted: string;
	ydRetryHint: string;
	ydSubmitHint: string;
	msErrActionNeedsBodyFmt: string;
	msDeletedFmt: string;
	msCannotCreateFmt: string;
	msVerbedFmt: string;
	bsErrInvalidEnvNameFmt: string;
	bsErrJobManagerUnavailable: string;
	bsErrAsyncDisabled: string;
	bsErrCommandBlocked: string;
	bsErrWorkdirMissingFmt: string;
	bsErrWorkdirNotDirFmt: string;
	bsErrAsyncManagerUnavailable: string;
	bsCommandAborted: string;
	bsCommandCancelled: string;
	bsCommandAbortedMarker: string;
	bsCommandTimedOut: string;
	bsCommandTimedOutAfterFmt: string;
	bsErrMissingExitStatusFmt: string;
	bsTimeoutClampedFmt: string;
	bsMaxTimeoutCeilingFmt: string;
	bsAllowedRangeFmt: string;
	bsWallTimeFmt: string;
	bsExitedCodeFmt: string;
	bsBackgroundedFmt: string;
	bsBlockedByPatternFmt: string;
	bsCriticalPatternDetected: string;
	bsPromptRequiredByPatternFmt: string;
	bsMissingCommand: string;
	bsCommandFmt: string;
	bsBackgroundedEarly: string;
	bsOutputTruncated: string;
	bsPtyUnavailable: string;
	bsBackgroundedFmt2: string;
	bsWallFmt: string;
	bsTimeoutDisabled: string;
	evErrPyDisabled: string;
	evErrPyUnavailableFmt: string;
	evErrRbDisabled: string;
	evErrRbUnavailableFmt: string;
	evErrJlDisabled: string;
	evErrJlUnavailableFmt: string;
	evErrJsDisabled: string;
	evOrWord: string;
	evLanguageFmt: string;
	evCodeLabel: string;
	evJavascriptDefault: string;
	evElidedChFmt: string;
	evDisplayFmt: string;
	brErrMissingCode: string;
	brActionLabel: string;
	brMissing: string;
	brTabLabel: string;
	brUrlLabel: string;
	brCodeLabel: string;
	cmErrNotArray: string;
	cmErrInvalidAction: string;
	cmErrClosed: string;
	cmErrSafetyApproval: string;
	iiErrNoAttachmentsFmt: string;
	iiErrResolveFmt: string;
	iiAttachmentListFmt: string;
	vbSpawnedFmt: string;
	vbNewTurnFmt: string;
	vbSteeredFmt: string;
	vbQueuedFmt: string;
	vbNoTurnsInFlight: string;
	xdDocsSuffixFmt: string;
	xdExecuteHintFmt: string;
	xdErrInvalidArgsFmt: string;
	dbgConfigPending: string;
	dbgVerified: string;
	dbgPending: string;
	dbgIfFmt: string;
	dbgMsgFmt: string;
	dbgLineFmt: string;
	dbgFunctionBreakpoints: string;
	dbgFuncFmt: string;
	dbgScopeFmt: string;
	dbgYes: string;
	dbgNo: string;
	dbgHintFmt: string;
	dbgVarFmt: string;
	dbgTypeFmt: string;
	dbgRefFmt: string;
	dbgNoReadableBytes: string;
	ssErrScopedPathInclude: string;
	ssErrRefDiffRevisions: string;
	ssErrRequiredFmt: string;
	ssErrNoAuthRegistry: string;
	ssErrDisabled: string;
	ttErrNoXaiCreds: string;
	ttSpeechGeneration: string;
	igSysPrompt: string;
	igErrMimeType: string;
	igErrEmptyData: string;
	igErrDownloadFmt: string;
	igErrUnsupportedUrlFmt: string;
	igErrTooLargeFmt: string;
	igErrUnsupportedTypeFmt: string;
	igErrNotFoundFmt: string;
	igErrEntriesPathOrData: string;
	igErrNoResponseBody: string;
	igErrMissingGptModel: string;
	igErrMissingProjectId: string;
	igErrAntigravityFailed: string;
	igErrMissingModelRegistry: string;
	rtiErrEmptyFmt: string;
	rtiErrInvalidFmt: string;
	dbgErrNoSession: string;
	dbgErrProgramRequired: string;
	dbgErrAttachPidOrPort: string;
	dbgErrSetBpFileLine: string;
	dbgErrRemoveBpFileLine: string;
	dbgErrSetInstBpRef: string;
	dbgErrRemoveInstBpRef: string;
	dbgErrDbInfoName: string;
	dbgErrSetDbDataId: string;
	dbgErrRemoveDbDataId: string;
	dbgErrEvalExpression: string;
	dbgErrVarsRef: string;
	dbgErrDisasmCount: string;
	dbgErrReadMemRef: string;
	dbgErrReadMemCount: string;
	dbgErrWriteMemRef: string;
	dbgErrWriteMemData: string;
	dbgErrCustomCommand: string;
	slErrRawWithSelectors: string;
	slErrQueryEmpty: string;
	slErrQueryNeedsSelector: string;
	slErrSelectorTable: string;
	slErrRowsWithParams: string;
	slErrRawNoParams: string;
	slErrUpdateColumn: string;
	buPathTraversal: string;
	bshCommandTimedOut: string;
	evErrNeedsSession: string;
	meErrUpdateRequires: string;
	glRootNotAllowed: string;
	ssErrSessionModel: string;
	ssErrValidationStatus: string;
	wrErrArchivePath: string;
	wrErrXdNotMounted: string;
	puErrLineSelectorZero: string;
	puErrScopeEmpty: string;
	puErrPathsRequired: string;
	mcpExampleScopes: string; // Example scopes hint

	cmdSsh: string;
	cmdSshAdd: string;
	cmdSshList: string;
	cmdSshRemove: string;
	cmdSshHelp: string;
	cmdNew: string;
	cmdFresh: string;
	cmdClear: string;
	cmdDrop: string;
	cmdCompact: string;
	cmdCompactElide: string;
	cmdCompactImages: string;
	cmdShake: string;
	cmdHandoff: string;
	cmdResume: string;
	cmdBtw: string;
	cmdTan: string;
	cmdOmfg: string;
	cmdRetry: string;
	cmdDebug: string;
	cmdMemory: string;
	cmdMemoryView: string;
	cmdMemoryStats: string;
	cmdMemoryDiagnose: string;
	cmdMemoryClear: string;
	cmdMemoryReset: string;
	cmdMemoryEnqueue: string;
	cmdMemoryRebuild: string;
	cmdMemoryMmList: string;
	cmdMemoryMmShow: string;
	cmdMemoryMmRefresh: string;
	cmdMemoryMmHistory: string;
	cmdMemoryMmSeed: string;
	cmdSecurity: string;
	cmdSecurityPlan: string;
	cmdSecurityScan: string;
	cmdSecurityStatus: string;
	cmdSecurityCancel: string;
	cmdSecurityScans: string;
	cmdSecurityShow: string;
	cmdSecurityImport: string;
	cmdSecurityExport: string;
	cmdSecurityValidate: string;
	cmdSecurityCompare: string;
	cmdSecurityDisposition: string;
	cmdSettings: string;
	cmdSetup: string;
	cmdSetupProviders: string;
	cmdPlan: string;
	toolTrackingLabel: string;
	toolTrackingSummary: string;
	cmdTracking: string;
	cmdTrackingAcp: string;
	cmdTrackingStatus: string;
	cmdTrackingPlan: string;
	cmdTrackingLog: string;
	cmdTrackingIndex: string;
	cmdTrackingStart: string;

	cmdAdvisor: string;
	cmdAdvisorOn: string;
	cmdAdvisorOff: string;
	cmdAdvisorStatus: string;
	cmdAdvisorDump: string;
	cmdAdvisorConfigure: string;
	cmdExportHtml: string;
	cmdDumpTranscript: string;
	cmdShare: string;
	cmdCollab: string;
	cmdCollabView: string;
	cmdCollabStatus: string;
	cmdCollabStop: string;
	cmdCollabJoin: string;
	cmdCollabLeave: string;
	cmdBrowserMode: string;
	cmdBrowserHeadless: string;
	cmdBrowserVisible: string;
	cmdCopyPick: string;
	cmdForce: string;
	cmdLiveVoice: string;
	cmdSidebar: string;
	cmdPause: string;
	cmdQuit: string;
	cmdMemoryMmDelete: string;
	cmdMemoryMmReload: string;
	cmdRename: string;
	cmdMove: string;
	cmdAddDir: string;
	cmdRemoveDir: string;
	cmdDirs: string;
	cmdExit: string;
	cmdMarketplace: string;
	cmdMarketplaceAdd: string;
	cmdMarketplaceRemove: string;
	cmdMarketplaceUpdate: string;
	cmdMarketplaceList: string;
	cmdMarketplaceDiscover: string;
	cmdMarketplaceInstall: string;
	cmdMarketplaceUninstall: string;
	cmdMarketplaceInstalled: string;
	cmdMarketplaceUpgrade: string;
	cmdMarketplaceHelp: string;
	cmdPlugins: string;
	cmdPluginsList: string;
	cmdPluginsEnable: string;
	cmdPluginsDisable: string;
	cmdReloadPlugins: string;
	cmdPlanReview: string;
	cmdVibe: string;
	cmdGoal: string;
	cmdGoalSet: string;
	cmdGoalShow: string;
	cmdGoalPause: string;
	cmdGoalResume: string;
	cmdGoalDrop: string;
	cmdGoalBudget: string;
	cmdGuidedGoal: string;
	cmdQueue: string;
	cmdModel: string;
	cmdModelSwitch: string;
	cmdFast: string;
	cmdFastOn: string;
	cmdFastOff: string;
	cmdFastStatus: string;
	cmdComputer: string;
	cmdComputerOn: string;
	cmdComputerOff: string;
	cmdComputerStatus: string;
	cmdVision: string;
	cmdVisionOn: string;
	cmdVisionOff: string;
	cmdVisionAuto: string;
	cmdVisionStatus: string;
	cmdPrewalk: string;
	cmdTodo: string;
	cmdTodoEdit: string;
	cmdTodoCopy: string;
	cmdTodoExport: string;
	cmdTodoImport: string;
	cmdTodoAppend: string;
	cmdTodoStart: string;
	cmdTodoDone: string;
	cmdTodoDrop: string;
	cmdTodoRm: string;
	cmdSession: string;
	cmdSessionInfo: string;
	cmdSessionDelete: string;
	cmdSessionPin: string;
	cmdJobs: string;
	cmdUsage: string;
	cmdUsageReset: string;
	cmdStats: string;
	cmdChangelog: string;
	cmdChangelogFull: string;
	cmdHotkeys: string;
	cmdTools: string;
	cmdContext: string;
	cmdExtensions: string;
	cmdAgents: string;
	cmdBranch: string;
	cmdFork: string;
	cmdTree: string;
	cmdLogin: string;
	cmdLogout: string;
	cmdMcp: string;
	cmdMcpAdd: string;
	cmdMcpList: string;
	cmdMcpRemove: string;
	cmdMcpTest: string;
	cmdMcpReauth: string;
	cmdMcpUnauth: string;
	cmdMcpEnable: string;
	cmdMcpDisable: string;
	cmdSmitherySearch: string;
	cmdSmitheryLogin: string;
	cmdSmitheryLogout: string;
	cmdMcpReconnect: string;
	cmdMcpReload: string;
	cmdMcpResources: string;
	cmdMcpPrompts: string;
	cmdMcpNotifications: string;
	cmdMcpHelp: string;

	// ── Slash-command ACP descriptions (English leftovers → M.*) ────────────
	cmdLoop: string;
	cmdSshAcp: string;
	cmdCompactAcp: string;
	cmdShakeAcp: string;
	cmdMemoryAcp: string;
	cmdMoveAcp: string;
	cmdAddDirAcp: string;
	cmdRemoveDirAcp: string;
	cmdDirsAcp: string;
	cmdMarketplaceAcp: string;
	cmdPluginsAcp: string;
	cmdReloadPluginsAcp: string;
	cmdModelAcp: string;
	cmdFastAcp: string;
	cmdComputerAcp: string;
	cmdVisionAcp: string;
	cmdPrewalkAcp: string;
	cmdTodoAcp: string;
	cmdSessionAcp: string;
	cmdJobsAcp: string;
	cmdUsageAcp: string;
	cmdChangelogAcp: string;
	cmdToolsAcp: string;
	cmdContextAcp: string;
	cmdMcpAcp: string;
	cmdAdvisorAcp: string;
	cmdDumpAcp: string;
	cmdDetectandFixProjectDiagnosticswithWeightedParallelSubagents: string;
	cmdDropAllThinkingBlocks: string;
	cmdEnablePremiumLongContextWindows: string;
	cmdMoveThisSessionIntoaNewWorktreeChangesIncluded: string;
	cmdOpentheGitUISplitDiffViewerStagingCommitComposer: string;
	cmdOpentheLiveAgentHub: string;
	cmdPinorUnpinaSessionattheTopoftheResumeList: string;
	cmdPlanRunInspectImportandCompareOMPNativeSecurityScans: string;
	cmdRestartOmpwiththeSameLaunchFlagsResumingThisSession: string;
	cmdRestoretheBoundedHUDPreview: string;
	cmdRewindtoaPreviousMessageKeepingtheOldPathAsaBranch: string;
	cmdRunMemoryConsolidationNow: string;
	cmdShowEveryPhaseandTaskintheHUD: string;
	cmdShowExtendedContextStatus: string;
	cmdShowPendingMemoryDeltasAwaitingConsolidation: string;
	cmdTogglePremiumLongContextWindows: string;
	cmdToggleUltraPlanModeFanOutScoutingIncrementalPlanWritesDeepestDecisionFloor: string;
	cmdUseStandardPricingContextWindows: string;
	cmdValidateOneFindingwithOMPNativeTools: string;
	cmdDetectAndFixProjectDiagnosticsWithWeightedParallelSubagents: string;
	cmdMoveThisSessionIntoANewWorktreeChangesIncluded: string;
	cmdOpenTheGitUiSplitDiffViewerStagingCommitComposer: string;
	cmdOpenTheLiveAgentHub: string;
	cmdOpenThisSessionsTraceInTheStatsDashboard: string;
	cmdPinOrUnpinASessionAtTheTopOfTheResumeList: string;
	cmdRestartOmpWithTheSameLaunchFlagsResumingThisSession: string;
	cmdRestoreTheBoundedHudPreview: string;
	cmdRewindToAPreviousMessageKeepingTheOldPathAsABranch: string;
	cmdShowEveryPhaseAndTaskInTheHud: string;
	cmdToggleLoopModeWhileEnabledTheNextPromptYouSendResubmitsAfterEveryYieldEscCancelsTheCurrentIterationLoopAgainToDisable: string;

	// ── Slash-command TUI autocomplete states ───────────────────────────────
	acPlanDisabledInSettings: string; // "Plan: disabled in settings"
	acPlanBlockedByGoalMode: string; // "Plan: blocked by goal mode"
	acPlanOff: string; // "Plan: off"
	acPlanOnFmt: string; // "Plan: on%s", %s = " (file)" when active
	acPlanReviewAvailable: string; // "Plan review: available"
	acPlanReviewInactive: string; // "Plan review: plan mode inactive"
	acVibeOn: string; // "Vibe: on"
	acVibeBlockedByPlanMode: string; // "Vibe: blocked by plan mode"
	acVibeBlockedByGoalMode: string; // "Vibe: blocked by goal mode"
	acVibeOff: string; // "Vibe: off"
	acGoalDisabledInSettings: string; // "Goal: disabled in settings"
	acGoalBlockedByPlanMode: string; // "Goal: blocked by plan mode"
	acGoalOff: string; // "Goal: off"
	acGoalOnFmt: string; // "Goal: %s (%s)", %s = status, %s = objective
	acLoopOff: string; // "Loop: off"
	acLoopPaused: string; // "Loop: paused"
	acLoopOnLimitFmt: string; // "Loop: on (%s)"
	acLoopOnRepeating: string; // "Loop: on (repeating prompt)"
	acLoopOnWaiting: string; // "Loop: on (waiting for next prompt)"
	acModelNone: string; // "Model: none selected"
	acModelFmt: string; // "Model: %s/%s", %s = provider, %s = id
	acFastFmt: string; // "Fast: %s"
	acComputerFmt: string; // "Computer: %s"
	acVisionFmt: string; // "Vision: %s"
	acFreshUnavailable: string; // "Fresh: unavailable while streaming"
	acFreshReady: string; // "Fresh: ready"
	acClearUnavailable: string; // "Clear: unavailable while streaming"
	acClearDrop: string; // "Clear: drop context, keep session"
	acCompactUsedFmt: string; // "Compact: context %s%% used"
	acCompactUnavailable: string; // "Compact: context unavailable"
	acJobsNone: string; // "Jobs: none"
	acJobsFmt: string; // "Jobs: %s running, %s recent"
	acToolsNone: string; // "Tools: none available"
	acToolsFmt: string; // "Tools: %s active / %s available"
	acContextUnavailable: string; // "Context: unavailable"
	acContextFmt: string; // "Context: %s%% (%s/%s)"
	acLeaveCollabHosting: string; // "Leave collab: hosting"
	acLeaveCollabGuest: string; // "Leave collab: guest"
	acLeaveCollabNone: string; // "Leave collab: not in collab"
	acAdvisorConfiguredNoModel: string;
	acAdvisorOff: string;
	acTodosNone: string;
	acTodosFmt: string;
	acForceNoActiveTools: string;

	// ── /compact subcommand mode descriptions ───────────────────────────────
	compactModeSoft: string;
	compactModeRemote: string;
	compactModeSnapcompact: string;

	// ── Settings page chrome (settings-selector.ts) ─────────────────────────
	setEnterSaveHint: string; // "Enter to save · Esc to cancel · Clear field to unset"
	setPreviewLabel: string; // "Preview:"
	setEnterSelectHint: string; // "Enter to select · Esc to go back"
	setToggleHint: string; // "Enter/Space to toggle · Esc to go back"
	setToggleOrderedHint: string; // "Enter/Space to toggle · ←/→ move · 1-9 place at position · Esc to go back"
	setMaxInFlightTitle: string; // "Max In-Flight Requests"
	setMaxInFlightDesc: string;
	setUnlimitedLabel: string; // "Unlimited"
	setLimitFmt: string; // "Limit: %s"
	setClearAllLimits: string; // "Clear all limits"
	setClearAllLimitsDesc: string; // "Make every provider unlimited"
	setEnterEditProviderHint: string; // "Enter to edit provider · Esc to go back"
	setMaxInFlightEditorTitleFmt: string; // "Max In-Flight Requests: %s"
	setMaxInFlightEditorDesc: string;
	setLimitPositiveError: string; // "Limit must be a positive number."
	setFooterSearchHint: string; // "Enter to change · Tab to jump tabs · Esc to exit search"
	setFooterPluginsHint: string; // "Tab to switch tabs · Esc to close"
	setFooterSectionsHint: string; // "↑/↓ to jump sections · Tab/Enter to settings · ←/→ to switch tabs · Esc to close"
	setNoMatchingSettings: string; // "No matching settings"
	setPreviewNotAvailable: string; // "(preview not available)"
	setTitleSettings: string; // "Settings" (top border)
	setPluginsTab: string; // "Plugins" (extra tab)
}

export { M } from "./index";
