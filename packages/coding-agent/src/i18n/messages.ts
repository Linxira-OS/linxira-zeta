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
	statusThatSubagentIsGoneOpenTheHubForLiveAgents: string; // That subagent is gone — open the hub for live agents
	statusSlashCommandIsHostOnlyDuringACollabSessionFmt: string; // %s is host-only during a collab session, %s = command
	statusFailedToSuspendFmt: string; // Failed to suspend: %s, %s = reason
	statusRestoredLastQueuedMessageToEditor: string; // Restored last queued message to editor
	statusQueuedNMessagesForAfterCompactionFmt: string; // Queued %d messages for after compaction, %d = count
	statusSentFirstMessageQueuedNForLaterYieldsFmt: string; // Sent first message; queued %d for later yields, %d = count
	statusQueuedNMessagesForWhenTheAgentYieldsFmt: string; // Queued %d messages for when the agent yields, %d = count
	statusUnsupportedPastedImageFormatFmt: string; // Unsupported pasted image format: %s, %s = mime type
	statusUnsupportedClipboardImageFormatFmt: string; // Unsupported clipboard image format: %s, %s = mime type
	statusUnsupportedPastedVideoPreviewFormat: string; // Unsupported pasted video preview format
	statusImageNotFoundAtPathFmt: string; // Image not found at %s, %s = path
	statusImageNotFoundAtPathOverSshFmt: string; // Image not found at %s. Over SSH this path is local to your terminal — paste the image directly (clipboard image-paste shortcut) to send its bytes., %s = path
	statusSavedPastedLinesFmt: string; // Saved %d pasted lines to local://%s, %d = line count, %s = paste name
	statusFailedToSavePasteToAFileAttachedAsTextChipInstead: string; // Failed to save paste to a file — attached as a text chip instead
	statusCopiedLineFmt: string; // Copied line: %s, %s = preview
	statusCopiedFmt: string; // Copied: %s, %s = preview
	statusToolActivityHiddenShowHintFmt: string; // Tool activity is hidden — show it with %s before expanding, %s = key hint
	statusToolOutputExpansionEnabled: string; // Tool output expansion: enabled
	statusToolOutputExpansionDisabled: string; // Tool output expansion: disabled
	statusToolActivityStateHidden: string; // Tool activity: hidden
	statusToolActivityStateVisible: string; // Tool activity: visible
	statusThinkingBlocksHidden: string; // Thinking blocks: hidden
	statusThinkingBlocksVisible: string; // Thinking blocks: visible
	statusRewoundToSelectedPoint: string; // Rewound to selected point
	statusNothingToCopyInThatItem: string; // Nothing to copy in that item
	statusCopiedLabelToClipboardFmt: string; // Copied %s to clipboard, %s = label
	statusOpeningFmt: string; // Opening %s: %s, %s = label, %s = href
	statusNoSessionsFoundFmt: string; // No %s sessions found, %s = source name
	statusUninstallingFmt: string; // Uninstalling %s..., %s = plugin id
	statusUninstalledFmt: string; // Uninstalled %s, %s = plugin id
	statusUninstallFailedFmt: string; // Uninstall failed: %s
	statusInstallingFromFmt: string; // Installing %s from %s..., %s = name, %s = marketplace
	statusInstalledFromFmt: string; // Installed %s from %s, %s = name, %s = marketplace
	statusInstallFailedFmt: string; // Install failed: %s
	selectorManualLoginPrompt: string; // Paste the authorization code (or full redirect URL), then press Enter:
	statusSessionOnlyModelFmt: string; // Session-only model: %s. Use %s or /model for roles., %s = selector, %s = key hint
	statusTaskSubagentModelFmt: string; // Task subagent model (session-only): %s. Use /agents to persist., %s = selector
	statusRoleModelFmt: string; // %s model: %s, %s = role label, %s = selector
	statusFailedToApplyPersonalityFmt: string; // Failed to apply personality: %s
	statusFailedToApplyPromptDocsFmt: string; // Failed to apply xd:// prompt docs setting: %s
	statusFailedToApplyMemoryBackendFmt: string; // Failed to apply memory backend: %s
	statusFailedToApplyExternalThinkingFmt: string; // Failed to apply external thinking: %s
	statusFailedToApplyMermaidFmt: string; // Failed to apply Mermaid rendering setting: %s
	statusFailedToLoadThemeFmt: string; // Failed to load theme "%s": %s\nFell back to dark theme.
	statusLoggingInToFmt: string; // Logging in to %s…, %s = provider id
	statusLogoutSkippedNoLongerStoredFmt: string; // Logout skipped: %s is no longer stored for %s.
	statusLogoutFailedFmt: string; // Logout failed: %s
	statusLogoutSkippedNoCredentialsFmt: string; // Logout skipped: no stored credentials for %s.%s
	statusAuthSourceLogoutHintFmt: string; // Current auth comes from %s; remove that source to log out.
	statusLoggedOutFmt: string; // Successfully logged out %s from %s
	statusCredentialRemovedFmt: string; // Credential removed from %s
	statusStillAuthenticatedFmt: string; // %s is still authenticated via %s
	statusCouldNotLoadStoredCredentialsFmt: string; // Could not load stored credentials: %s
	statusNoStoredOAuthAccountsFmt: string; // No stored OAuth accounts for %s. Use /login to add one.
	statusNoStoredOAuthAccountsSourceFmt: string; // No stored OAuth accounts for %s. Current auth comes from %s.
	statusNoLongerAvailableToPinFmt: string; // %s is no longer available to pin.
	statusPinnedFmt: string; // Pinned %s to this session for %s.
	statusCouldNotLoadSavedResetsFmt: string; // Could not load saved resets: %s
	statusNoSavedResetsUnreachable: string; // No saved resets available — some accounts couldn't be reached (try /login).
	statusNoSavedResetsAvailable: string; // No saved rate-limit resets available to spend right now.
	statusSpendingSavedResetFmt: string; // Spending 1 saved reset for %s…
	statusResetFailedFmt: string; // Reset failed for %s: %s
	statusSummarizeBranchTitle: string; // Summarize branch?
	statusChoiceNoSummary: string; // Choice label + branch sentinel
	statusChoiceSummarize: string; // Choice label
	statusChoiceSummarizeCustomPrompt: string; // Choice label + branch sentinel
	statusCustomSummarizationInstructions: string; // Custom summarization instructions editor title
	statusSummarizingBranch: string; // Summarizing branch... (esc to cancel)

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
	mcpTestAlreadyFinishedFmt: string; // MCP test for "%s" already finished
	mcpRemoveNameRequired: string; // Server name required. Usage: /mcp remove <name> [--scope project|user]
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
	ccComputerUseStateFmt: string; // "Computer use: %s" status diagnostic, %s = stateEnabled/stateDisabled
	ccPreludeStateFmt: string; // "prelude: %s" status diagnostic, %s = stateActive/stateInactive
	ccComputerConfiguredFmt: string; // "configured: display=%s, maxWidth=%s, maxHeight=%s"
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
	ccFailedToSwitchWorkspaceFmt: string; // Failed to switch workspace: %s
	ccFailedToRollbackMoveRealignFmt: string; // Failed to roll back move: %s (failed to re-align workspace to %s)
	ccFailedToRollbackMoveFmt: string; // Failed to roll back move: %s (workspace remains at %s)
	ccFailedToRestoreSourceWorkspaceFmt: string; // Failed to restore source workspace after rollback: workspace remains at %s
	ccNoSessionFileYet: string; // No session file yet — send a message first.
	ccTraceFmt: string; // Trace: %s, %s = url
	ccFailedToOpenTraceFmt: string; // Failed to open trace: %s
	ccLabelServed: string; // "Served:" row label
	ccLabelCredits: string; // "Credits:" row label
	ccLabelCommittedCredits: string; // "Committed Credits:" row label
	ccLabelCommittedAcu: string; // "Committed ACU:" row label
	ccMemoryConsolidationRan: string; // Memory consolidation ran.
	ccWaitForResponseResetContext: string; // Wait for the current response to finish or abort it before resetting the context.
	ccContextResetOneFmt: string; // Context reset — 1 message dropped; session continues.
	ccContextResetManyFmt: string; // Context reset — %s messages dropped; session continues., %s = count
	ccNothingToDelete: string; // Nothing to delete (in-memory session)
	ccWaitForResponseWorktree: string; // Wait for the current response to finish or abort it before creating a worktree.
	ccCreatingWorktreeFmt: string; // Creating worktree on %s…, %s = branch
	ccWorktreeCreateFailedFmt: string; // Worktree creation failed: %s
	ccWorktreeCleanupFailedFmt: string; // Worktree created, but cleaning source checkout failed: %s
	ccWaitForCompactionHandoff: string; // Wait for context compaction to finish or cancel it before handing off.
	ccContextHandedOff: string; // Context handed off and compacted in place
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
	cmdLoopLong: string;
	cmdRenameGenerate: string;
	imPlanUltraModeEnabledFmt: string;
	imPlanModePaused: string;
	imPlanModeDisabled: string;
	imPlanModeDisabledSetting: string;
	imExitPlanModeTitle: string;
	imAttachGoalModeActiveFmt: string;
	imAttachVibeModeActive: string;
	imPlanCopiedToClipboard: string;
	imPlanUpdatedExternal: string;
	imRefinePlanPrompt: string;
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
	ssUnlimited: string; // Unlimited (no cap)
	ssLimitFmt: string; // Limit: %s
	ssOn: string; // Boolean value display: on
	ssOff: string; // Boolean value display: off
	ssTabAppearance: string; // Appearance tab label
	ssTabModel: string; // Model tab label
	ssTabInteraction: string; // Interaction tab label
	ssTabContext: string; // Context tab label
	ssTabMemory: string; // Memory tab label
	ssTabFiles: string; // Files tab label
	ssTabShell: string; // Shell tab label
	ssTabTools: string; // Tools tab label
	ssTabTasks: string; // Tasks tab label
	ssTabProviders: string; // Providers tab label
	ssTabPlugins: string; // Plugins tab label
	ssFooterPrefix: string; // Enter/Space to change
	ssFooterSuffix: string; // Type to search · Esc to close
	ssSectionsFocusedHint: string; // ↑/↓ to jump sections · Tab/Enter to settings · ←/→ to switch tabs · Esc to close
	ssOrderedDefault: string; // default (ordered multiselect empty value)
	ssUnorderedNone: string; // none (multiselect empty value)
	ssTitleSettings: string; // Settings screen title
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
	ecActionRemote: string; // Auto server compaction
	ecRemoteCancelled: string; // Auto server compaction cancelled
	ecRemoteFailed: string; // Auto server compaction failed; continuing without maintenance
	ecRetryLabelFmt: string; // Retrying (%s/%s), %s = attempt, %s = max attempts
	ecRetryInFmt: string; // " in %s…" countdown suffix, %s = duration
	ecFallbackFmt: string; // Fallback: %s -> %s, %s = from model, %s = to model
	ecFallbackSucceededFmt: string; // Fallback succeeded on %s, %s = model
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
	cmdBtwHistory: string;
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
	cmdSettingsReset: string;
	settingsResetConfirmHint: string;
	settingsResetDoneFmt: string;
	settingsResetKeyDoneFmt: string;
	settingsResetNothing: string;
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
	cmdCollabList: string;
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
	acSidebarOn: string;
	acSidebarOff: string;
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
	cmdSwitchModelWithSelectors: string; // /switch: fuzzy ids, provider/id, @role, :level
	cmdSwitchModelSessionOnly: string; // /switch acpDescription
	cmdSkillful: string; // /skillful
	cmdSkillfulAcp: string; // /skillful acpDescription
	cmdSkillfulOn: string; // /skillful on
	cmdSkillfulOff: string; // /skillful off
	cmdSkillfulStatus: string; // /skillful status
	cmdToggleExtendedContext: string; // /extended-context acpDescription
	cmdToggleTheNativeComputerUseEvalPreludeForThisSession: string; // /computer
	cmdToggleBrowserEvalPreludeHeadlessVsVisibleMode: string; // /browser
	cmdOpenLastLinkFromConversation: string; // /open
	cmdInitGenerateAgentsMd: string; // bundled /init zh overlay (task/commands.ts)

	// ── Slash-command ACP descriptions (English leftovers → M.*) ────────────
	cmdLoop: string;
	cmdRecord: string;
	cmdSshAcp: string;
	cmdCompactAcp: string;
	lcSessionNotFoundFmt: string; // Session "%s" not found
	lcCouldNotGenerateTitle: string; // Could not generate a session title. Use /rename <title> to set one.
	colQrFailedFmt: string; // Failed to render collab QR code: %s
	colAdvisorEnabled: string; // Advisor enabled.
	colAdvisorSettingEnabledNoModel: string; // Advisor setting enabled, but no model is assigned to the 'advisor' role.
	colAdvisorDisabled: string; // Advisor disabled.
	colAdvisorUsage: string; // Usage: /advisor [on|off|status|dump [raw]|configure]
	colCollabStopped: string; // Collab stopped
	colCollabStatusFmt: string; // Collab: %s — %s, %s = names, %s = link
	colNotInCollabSession: string; // Not in a collab session
	colCollabListUsageFmt: string; // Usage: /collab list — for links or JSON use `%s collab link|list`, %s = app name
	colNoActiveCollabHosts: string; // No active Collab hosts
	colAlreadyGuest: string; // Already in a collab session as a guest (/leave first)
	colFailedToStartFmt: string; // Failed to start collab session: %s
	colJoinUsage: string; // Usage: /join <link>
	colAlreadyInCollab: string; // Already in a collab session (/leave first)
	colStopHostingFirst: string; // Stop hosting first (/collab stop)
	colFailedToJoinFmt: string; // Failed to join collab session: %s
	colBrowserDisabled: string; // Browser capability is disabled (enable in settings)
	colBrowserUsage: string; // Usage: /browser [headless|visible]
	colFailedToRestartBrowserFmt: string; // Failed to restart browser: %s
	colBrowserModeFmt: string; // Browser mode: %s, %s = headless|visible
	colInCollabReadOnlyGuest: string; // In a collab session as a read-only guest (/leave to exit)
	colInCollabGuest: string; // In a collab session as a guest (/leave to exit)
	colNoCodeBlockToCopy: string; // No code block to copy.
	colCopiedCodeBlock: string; // Copied code block to clipboard
	colNoCommandToCopy: string; // No command to copy.
	colCopiedToClipboardFmt: string; // Copied %s to clipboard, %s = kind
	colNoLinkToCopy: string; // No link to copy.
	colCopiedLink: string; // Copied link to clipboard
	colCopyUsage: string; // Usage: /copy [code|cmd|link]
	colOpenUsage: string; // Usage: /open [link]  (pick a specific link: /copy, → blocks, o)
	colNoLinkToOpen: string; // No link to open.
	colOpeningFmt: string; // Opening %s, %s = href
	bmSettingsUsage: string; // Usage: /settings [reset [confirm|<key>]]
	bmSettingsResetUsage: string; // Usage: /settings reset [confirm|<key>]
	bmUnknownSettingFmt: string; // Unknown setting: %s
	bmModelProvidersUsageFmt: string; // Usage: /%s [providers], %s = command name
	bmUnknownModelFmt: string; // Unknown model: %s
	bmFastModeEnabled: string; // Fast mode enabled.
	bmFastModeDisabled: string; // Fast mode disabled.
	bmFastModeStatusFmt: string; // Fast mode is %s., %s = status
	bmSkillListingToggledFmt: string; // Skill listing %s for this session., %s = enabled|disabled
	bmSkillfulUsage: string; // Usage: /skillful [on|off|status]
	bmComputerUsage: string; // Usage: /computer [on|off|status]
	bmFastUsage: string; // Usage: /fast [on|off|status]
	bmSkillListingFmt: string; // Skill listing: %s., %s = on|off
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
	cmdPrewalkRestart: string;
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
	cmdEnableLargerContextWindows: string;
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
	cmdToggleExtendedContextWindows: string;
	cmdToggleUltraPlanModeFanOutScoutingIncrementalPlanWritesDeepestDecisionFloor: string;
	cmdUseDefaultOrStandardPricingContextWindows: string;
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
	acExtendedContextFmt: string; // "Extended context: %s", %s = stateOn/stateOff
	acSkillfulFmt: string; // "Skill listing: %s", %s = stateOn/stateOff
	acAdvisorOnFmt: string; // "Advisor: on (%s)", %s = count fmt or provider/model
	acCollabFmt: string; // "Collab: %s", %s = stateHosting/stateGuest/stateReadOnlyGuest/stateOff
	acCollabGuestsFmt: string; // " (%s guests)" suffix for acCollabFmt hosting state
	acBrowserFmt: string; // "Browser: %s", %s = stateDisabled/stateHeadless/stateVisible
	acPlanUltraDisabledInSettings: string;
	acPlanUltraOnFmt: string; // "Plan-ultra: on%s", %s = plan-file suffix
	acPlanUltraAlreadyActive: string;
	acPlanUltraBlockedByGoalMode: string;
	acPlanUltraOff: string;

	// ── state tokens for dynamic status-line templates ──────────────────────
	stateOn: string; // "on"
	stateOff: string; // "off"
	stateHosting: string; // collab host active
	stateGuest: string; // collab guest (can prompt)
	stateReadOnlyGuest: string; // collab guest (watch only)
	stateHeadless: string; // browser headless
	stateVisible: string; // browser visible
	stateEnabled: string; // feature enabled
	stateDisabled: string; // feature disabled
	stateActive: string; // prelude active
	stateInactive: string; // prelude inactive

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
	// ── Setup wizard: composer scene (pi-tui setup/scenes/composer.ts) ──────
	setupComposerTitle: string; // "Choose composer shape"
	setupComposerSubtitle: string;
	setupComposerIntro: string; // live-preview hint
	setupComposerPreviewLabel: string; // "Preview:"

	// ── Prompt "#" actions (pi-tui prompt-action-autocomplete.ts) ───────────
	promptActionCopyLine: string; // "Copy current line"
	promptActionCopyPrompt: string; // "Copy whole prompt"
	promptActionUndo: string; // "Undo"
	promptActionCursorMessageEnd: string;
	promptActionCursorMessageStart: string;
	promptActionCursorLineStart: string;
	promptActionCursorLineEnd: string;
	promptActionDescCurrentMessage: string; // "Current message" description

	// ── /tools markdown table (pi-tui tools-markdown.ts) ────────────────────
	toolsMarkdownTool: string; // "Tool" header
	toolsMarkdownDescription: string; // "Description" header
	toolsMarkdownNoTools: string; // empty state
	toolsMarkdownNoDescription: string; // per-row fallback

	// ── Extensions dashboard (pi-tui overlays/extensions) ───────────────────
	extDashboardTitle: string; // top border title
	extDashboardFooterFmt: string; // %s = expand key hint
	extTabAll: string; // "ALL" provider tab label
	extListSearch: string; // "Search: " prefix
	extListTypeToFilter: string; // unfocused search placeholder
	extListEmpty: string; // empty provider list
	extListEnableMasterFmt: string; // "Enable %s", %s = provider name
	extListMasterBadge: string; // "(Master Switch)"
	extListLoadUserSourceFmt: string; // "Load ~/ %s config", %s = provider name
	extListUserSourceBadge: string; // opt-in badge
	extKindExtensionModules: string;
	extKindSkills: string;
	extKindTools: string;
	extKindCommands: string;
	extKindRules: string;
	extKindMcp: string;
	extKindHooks: string;
	extKindPrompts: string;
	extKindContext: string;
	extKindInstructions: string;
	extKindContextFiles: string;
	extKindSlashCommands: string;
	extParamRequired: string; // tool param flag
	extParamOptional: string; // tool param flag
	extParamDefaultFmt: string; // "Default: %s", %s = JSON default
	extStateActive: string; // enablement badge
	extStateDisabledFmt: string; // "Disabled (%s)", %s = reason text
	extStateDisabledProvider: string; // reason: provider disabled
	extStateDisabledOptIn: string; // reason: ~/ config not enabled
	extStateDisabledManually: string; // reason: manually disabled
	extStateUnknown: string; // reason: unknown
	extStateShadowed: string; // "Shadowed"
	extStateShadowedFmt: string; // "Shadowed by %s", %s = winner id
	extHintHidden: string; // "hidden" list hint
	extHintHiddenFmt: string; // "hidden · %s", %s = tool count text
	extHintToolsFmt: string; // "%d tools", %d = live tool count
	extHintAlways: string; // "always" list hint
	extInspectorSelectExtension: string; // empty pane line 1
	extInspectorToViewDetails: string; // empty pane line 2
	extInspectorSectionTools: string; // section heading
	extInspectorSectionResources: string; // section heading
	extInspectorSectionPrompts: string; // section heading
	extInspectorSectionArguments: string; // section heading
	extInspectorSectionApplies: string; // section heading
	extInspectorSectionHook: string; // section heading
	extInspectorSectionInvocation: string; // section heading
	extInspectorSectionTrigger: string; // section heading
	extInspectorHeadingRule: string; // preview heading
	extInspectorHeadingInstruction: string; // preview heading
	extInspectorHeadingTemplate: string; // preview heading
	extInspectorHeadingPrompt: string; // preview heading
	extInspectorHeadingPreview: string; // preview heading
	extInspectorCommand: string; // "Command" field label
	extInspectorArgs: string; // "Args" field label
	extInspectorEnvVars: string; // "Env vars" field label
	extInspectorEnvCountFmt: string; // "%d defined", %d = env var count
	extInspectorAlways: string; // "always" accent tag
	extInspectorAlwaysApply: string; // "always apply" accent tag
	extInspectorNoApplyConditions: string; // "(no apply conditions)"
	extInspectorAcceptsArguments: string; // "accepts $ARGUMENTS"
	extInspectorPatternsFmt: string; // "%d patterns", %d = glob count
	extInspectorMoreFmt: string; // "… %d more (%s to expand)", %d = hidden, %s = key hint
	extInspectorOrigin: string; // "Origin:" line label
	extInspectorViaFmt: string; // "via %s (%s)", %s = provider, %s = level
	extLevelUser: string; // source level label
	extLevelProject: string; // source level label
	extLevelNative: string; // source level label

	// ── Welcome tips (pi-tui prompt/welcome.ts; tipN = tips.txt line N) ─────
	tip1: string;
	tip2: string;
	tip3: string;
	tip4: string;
	tip5: string;
	tip6: string;
	tip7: string;
	tip8: string;
	tip9: string;
	tip10: string;
	tip11: string;
	tip12: string;
	tip13: string;
	tip14: string;
	tip15: string;
	tip16: string;
	tip17: string;
	tip18: string;
	tip19: string;
	tip20: string;
	tip21: string;
	tip22: string;
	tip23: string;
	tip24: string;
	tip25: string;
	tip26: string;
	tip27: string;
	// ── Chat transcript render layer (pi-tui chat/*, status-line/*, tools/*, apps/*) ──
	statusInterrupted: string; // render mapping for USER_INTERRUPT_LABEL — "Interrupted by user"
	statusOperationAborted: string; // "Operation aborted"
	statusAbortedAfterRetryOneFmt: string; // "Aborted after %d retry attempt"
	statusAbortedAfterRetryManyFmt: string; // "Aborted after %d retry attempts"
	execRunningEscCancel: string; // "Running… (esc to cancel)"
	execColumnsOmittedFmt: string; // "… [%s visible columns omitted]"
	execMoreLinesHintFmt: string; // "… %s more lines (ctrl+o to expand)"
	execCancelledMarker: string; // "(cancelled)"
	execExitFmt: string; // "(exit %s)"
	todoReminderHeaderOneFmt: string; // "%d incomplete todo - reminder %s/%s"
	todoReminderHeaderManyFmt: string; // "%d incomplete todos - reminder %s/%s"
	compactionFromToTokensFmt: string; // "Compacted from %s to %s tokens"
	compactionFromTokensFmt: string; // "Compacted from %s tokens"
	compactionToTokensFmt: string; // "Compacted to %s tokens"
	compactionContextLabel: string; // "Compacted context"
	toolEditPendingOneFmt: string; // "%d more file pending…"
	toolEditPendingManyFmt: string; // "%d more files pending…"
	lateDiagTitle: string; // "Late diagnostics"
	syntheticInputLabel: string; // "Synthetic input"
	skillLinesOneFmt: string; // "%d line"
	skillLinesManyFmt: string; // "%d lines"
	skillPromptLabel: string; // "prompt"
	skillUnknownName: string; // "unknown"
	ctxLegendSystemPrompt: string; // "System prompt"
	ctxLegendSystemTools: string; // "System tools"
	ctxLegendSystemContext: string; // "System context"
	ctxLegendSkills: string; // "Skills"
	ctxLegendMessages: string; // "Messages"
	ctxNoModel: string; // "no model"
	ctxWindowSuffixFmt: string; // "(%s context)"
	ctxTokensOfFmt: string; // "/%s tokens"
	ctxTokensPctFmt: string; // "tokens (%s)"
	ctxPctFmt: string; // "(%s)"
	ctxEstimatedByCategory: string; // "Estimated usage by category"
	ctxFreeSpace: string; // "Free space:"
	ctxAutocompactBuffer: string; // "Autocompact buffer:"
	ctxUnavailableNoModel: string; // "Context usage is unavailable: no model is selected for this session."
	footerThinkingAuto: string; // "auto" thinking-level placeholder
	loopUntilPrefix: string; // "until" loop condition prefix
	loopWhilePrefix: string; // "while" loop condition prefix
	globNoFiles: string; // "No files found"
	globNoMatchesBeforeTimeout: string; // "No matches before timeout (scan incomplete)"
	globZeroFiles: string; // "0 files"
	globTimedOut: string; // "timed out"
	globFileOne: string; // "1 file"
	globFileManyFmt: string; // "%d files"
	globTruncated: string; // "truncated"
	globTruncatedReasonsFmt: string; // "truncated: %s"
	globLimitResultsFmt: string; // "limit %s results"
	globLineLimit: string; // "line limit"
	globSizeLimit: string; // "size limit"
	grepTruncated: string; // "truncated"
	grepItemOne: string; // "1 item"
	grepItemManyFmt: string; // "%d items"
	grepMatchOne: string; // "1 match"
	grepMatchManyFmt: string; // "%d matches"
	grepFileOne: string; // "1 file"
	grepFileManyFmt: string; // "%d files"
	agrpSearchedFmt: string; // "searched %s"
	agrpMatchOne: string; // "1 match"
	agrpMatchManyFmt: string; // "%d matches"
	agrpFileOne: string; // "1 file"
	agrpFileManyFmt: string; // "%d files"
	taskNoResults: string; // "No results"
	taskNestedProgressShown: string; // "… nested task progress already shown"
	taskDoneFmt: string; // "%d done"
	taskRunningFmt: string; // "%d running"
	taskPendingFmt: string; // "%d pending"
	taskFailedFmt: string; // "%d failed"
	taskAbortedFmt: string; // "%d aborted"
	todoOpFailed: string; // "Todo operation failed"
	todoNoTodosFallback: string; // "No todos"
	todoTaskOne: string; // "1 task"
	todoTaskManyFmt: string; // "%d tasks"
	todoItemOne: string; // "1 item"
	todoItemManyFmt: string; // "%d items"
	wsErrorFmt: string; // "Error: %s"
	wsSourceOne: string; // "1 source"
	wsSourceManyFmt: string; // "%d sources"
	wsNoAnswerText: string; // "No answer text returned"
	wsNoSourcesReturned: string; // "No sources returned"
	rsAccept: string; // "Accept"
	rsFailed: string; // "Failed"
	rsDiscard: string; // "Discard"
	askTitle: string; // "Ask"
	askChatRedirectMeta: string; // "chat redirect"
	askMultiMeta: string; // "multi"
	askQuestionOne: string; // "1 question"
	askQuestionManyFmt: string; // "%d questions"
	hbIrcInboxTitle: string; // "IRC inbox"
	hbIrcPeersTitle: string; // "IRC peers"
	hbInboxEmpty: string; // "empty"
	hbPeekMeta: string; // "peek"
	hbNoOtherAgents: string; // "no other agents"
	hbUnreadOne: string; // "1 unread"
	hbUnreadManyFmt: string; // "%d unread"
	hbMessageOne: string; // "1 message"
	hbMessageManyFmt: string; // "%d messages"
	hbIrcAnyone: string; // "anyone"
	hbIrcCallFailed: string; // "IRC call failed."
	hbMoreLineOneFmt: string; // "… +%s more line"
	hbMoreLinesManyFmt: string; // "… +%s more lines"
	gitNoChanges: string; // "No changes"
	gitNoCommitsYet: string; // "No commits yet"
	gitLoadingDiff: string; // "Loading diff…"
	gitStreamingFile: string; // "Streaming file…"
	gitNoFileSelected: string; // "no file selected"
	gitDiscardFileConfirmFmt: string; // "Discard changes to %s? Press delete again to confirm"
	gitDiscardHunkConfirm: string; // "Discard hunk? Press x (or click) again to confirm"
	gitDiscardLinesConfirm: string; // "Discard selected lines? Press x again to confirm"
	gitStagedFmt: string; // "Staged %s"
	gitStagedAll: string; // "Staged all changes"
	gitUnstagedFmt: string; // "Unstaged %s"
	gitUnstagedAll: string; // "Unstaged all changes"
	gitDiscardedFmt: string; // "Discarded %s"
	gitFilteringChangesFmt: string; // "Filtering changes: %s"
	gitNoChangesMatchedFmt: string; // 'No changes matched "%s"'
	gitHunksOfFmt: string; // "%s of %s hunks"
	gitWholeFileOne: string; // "1 whole file"
	gitWholeFileManyFmt: string; // "%d whole files"
	gitAiStagedFmt: string; // "Staged %s (%s/%s files matched)"
	gitGeneratingCommit: string; // "Generating commit message…"
	gitGeneratedNeedsReviewFmt: string; // "Generated message needs review: %s"
	gitStagedAndGenerated: string; // "Staged all changes and generated commit message"
	gitGeneratedMessage: string; // "Generated commit message"
	gitAmendedCommit: string; // "Amended commit"
	gitCreatedCommit: string; // "Created commit"
	gitStagedHunk: string; // "Staged hunk"
	gitUnstagedHunk: string; // "Unstaged hunk"
	gitDiscardedHunk: string; // "Discarded hunk"
	gitSelectionNoChanges: string; // "Selection contains no changes"
	gitStagedSelection: string; // "Staged selection"
	gitUnstagedSelection: string; // "Unstaged selection"
	gitDiscardedSelection: string; // "Discarded selection"
	gitWsShowAll: string; // "Showing all changes"
	gitWsIgnoreWhitespace: string; // "Ignoring whitespace-only line changes"
	gitWsIgnoreFormatting: string; // "Ignoring formatting and import-only changes"
	gitHintDiff: string; // diff-pane key hints row
	gitHintSidebar: string; // sidebar key hints row
	gitStageFileBtn: string; // " Stage File " pill (padding spaces included)
	gitUnstageFileBtn: string; // " Unstage File " pill (padding spaces included)
	gitContentKindBinary: string; // "Binary"
	gitContentKindMedia: string; // "Media"
	gitChipStaged: string; // " Staged " scope chip (padding spaces included)
	gitChipUnstaged: string; // " Unstaged " scope chip (padding spaces included)
	gitChipUntracked: string; // " Untracked " scope chip (padding spaces included)
	gitStageAllPill: string; // "Stage All"
	gitUnstageAllPill: string; // "Unstage All"
	gitUnstagedFilesFmt: string; // "Unstaged Files (%s)"
	gitStagedFilesFmt: string; // "Staged Files (%s)"
	gitNoUnstagedFiles: string; // "   no unstaged files"
	gitNoStagedFiles: string; // "   no staged files"
	gitAiPromptPlaceholder: string; // "What should we stage?"
	gitAmendPrevious: string; // "Amend previous commit"
	gitCommitSummaryLabel: string; // "Commit summary"
	gitDescriptionPlaceholder: string; // "Description"
	gitBtnGenerating: string; // "-○- Generating commit message"
	gitBtnCommitStaged: string; // "-○- Commit staged changes"
	gitBtnStageAllCommit: string; // "-○- Stage all & commit"
	gitFileChangesOnOneFmt: string; // "%s file change on "
	gitFileChangesOnManyFmt: string; // "%s file changes on "
	gitAuthoredFmt: string; // " authored %s"
	gitParentLabel: string; // "parent:"
	gitLoadingChangedFiles: string; // " Loading changed files…"
	gitModifiedCountFmt: string; // "%s modified"
	gitNoFile: string; // "No file"
	gitTextObject: string; // "Text object"
	gitBinaryObject: string; // "Binary object"
	gitSizeUnavailable: string; // "Size unavailable"
	gitObjectTooLarge: string; // "Object too large to preview"
	gitExceedsPreviewLimit: string; // "Exceeds preview limit"
	gitLfsObjectUnavailable: string; // "Git LFS object unavailable"
	gitAssetBefore: string; // "Before" asset pane title
	gitAssetAfter: string; // "After" asset pane title
	gitKindText: string; // "Text"
	gitKindBinary: string; // "Binary"
	gitKindTooLarge: string; // "Too large"
	gitKindLfsMissing: string; // "LFS missing"
	psVerbStop: string; // "stop"
	psVerbKill: string; // "kill"
	psVerbRestart: string; // "restart"
	psActingFmt: string; // "%s %s…"
	psActionFailedFmt: string; // "%s %s failed: %s"
	psRestarted: string; // "Restarted"
	psKilled: string; // "Killed"
	psStopped: string; // "Stopped"
	psShowingAllScopes: string; // "Showing all scopes"
	psShowingCurrentScope: string; // "Showing current scope"
	psUpdatedAgoFmt: string; // "updated %s ago"
	psUpdating: string; // "updating…"
	psScopesOneFmt: string; // "%s process in %s scope"
	psScopesManyFmt: string; // "%s processes in %s scopes"
	psScopeAll: string; // "(all)"
	psScopeCurrent: string; // "(current)"
	psFooterHints: string; // process table footer hints
	psNoProcesses: string; // "   no processes"
	psNoScopes: string; // " No daemon broker scopes found."
	psProcessInfo: string; // "process info"
	psBackHints: string; // "esc back · q back"
	psLogsHints: string; // "esc back · q back · view refreshes live"
	psLogsTitleFmt: string; // "logs %s"
	psLabelCommand: string; // "command:"
	psLabelCwd: string; // "cwd:"
	psLabelUptime: string; // "uptime:"
	psLabelExit: string; // "exit:"
	psLabelRestarts: string; // "restarts:"
	psLabelOwner: string; // "owner:"
	psRestartsFmt: string; // "%s (policy: %s)"
	psLoading: string; // " loading…"
	// ── MCP runtime dashboard (pi-tui overlays/extensions/mcp-runtime.ts) ───
	mcpHealthNotConnected: string; // "Not connected"
	mcpHealthInactive: string; // "Inactive"
	mcpListHintConnecting: string; // "connecting…"
	mcpListHintUnavailable: string; // "unavailable"
	mcpListToolOneFmt: string; // "%d tool"
	mcpListToolManyFmt: string; // "%d tools"
	mcpListResourceOneFmt: string; // "%d resource"
	mcpListResourceManyFmt: string; // "%d resources"
	mcpListPromptOneFmt: string; // "%d prompt"
	mcpListPromptManyFmt: string; // "%d prompts"
	mcpOAuthNoHostHandler: string; // "OAuth login cannot start without a host OAuth handler."
	// ── Marketplace plugin selector (pi-tui overlays/plugin-selector.ts) ────
	pluginSelectorInstalled: string; // " [installed]"
	pluginSelectorEmpty: string; // "No plugins available"
	pluginSelectorAddMarketplaceFirst: string; // "Add a marketplace first: /marketplace add <source>"
	pluginSelectorNoPluginsInMarketplaces: string; // "Configured marketplaces have no plugins"
	// ── Plugin settings panel (pi-tui overlays/plugin-settings.ts) ──────────
	pluginSettingsNoPlugins: string; // "No plugins installed"
	pluginSettingsInstallNpmHint: string; // "Install npm plugins:        zeta plugin install <package>"
	pluginSettingsInstallMarketplaceHint: string; // "Install marketplace plugins: zeta plugin install <name>@<marketplace>"
	pluginSettingsListFooter: string; // "Enter to configure · Esc to go back"
	pluginSettingsFeaturesFmt: string; // "%d/%d features"
	pluginSettingsShadowedByFmt: string; // "shadowed by %s"
	pluginSettingsEnabled: string; // "Enabled"
	pluginSettingsEnableFeatureFmt: string; // "Enable %s feature"
	pluginSettingsDetailFooterHint: string; // "Enter to edit · Esc to go back"
	pluginSettingsConfigureFmt: string; // "Configure %s"
	pluginSettingsSelectValueFmt: string; // "Select value for %s"
	pluginSettingsEnumHint: string; // "Enter to select · Esc to cancel"
	pluginSettingsTypeFmt: string; // "Type: %s"
	pluginSettingsInputHint: string; // "Enter to save · Esc to cancel"
	pluginSettingsVersionFmt: string; // "version       %s"
	pluginSettingsScopeFmt: string; // "scope         %s"
	pluginSettingsInstallPathFmt: string; // "install path  %s"
	pluginSettingsInstalledAtFmt: string; // "installed at  %s"
	pluginSettingsLastUpdatedFmt: string; // "last updated  %s"
	pluginSettingsGitShaFmt: string; // "git sha       %s"
	// ── tui overlays & shared component chrome (overlays/*, components/*) ──
	loginTitleFmt: string; // "Login to %s", %s = provider name
	loginClickHintFmt: string; // "%s+click to open", %s = Cmd/Ctrl
	loginLocalShortcutFmt: string; // "Local shortcut (this machine only): %s"
	loginExampleFmt: string; // "e.g., %s"
	loginEscapeToCancel: string; // "(Escape to cancel)"
	loginEscapeEnterHint: string; // "(Escape to cancel, Enter to submit)"
	loginInputCancelled: string; // rejection reason
	oauthSelectLoginTitle: string; // "Select provider to login"
	oauthSelectLogoutTitle: string; // "Select provider to logout"
	oauthSearchFmt: string; // "Search: %s"
	oauthTypeToSearch: string; // "Type to search"
	oauthNoProvidersAvailable: string; // "No OAuth providers available"
	oauthNoStoredCredentials: string; // "No stored provider credentials to log out"
	oauthNoMatchingProviders: string; // "No matching providers"
	oauthProviderUnavailable: string; // "Provider unavailable in this environment."
	oauthStatusChecking: string; // "checking"
	oauthStatusInvalid: string; // "invalid"
	oauthStatusLoggedIn: string; // "logged in"
	oauthOriginConfig: string; // credential origin tag
	oauthOriginLogin: string; // credential origin tag
	oauthOriginApiKey: string; // credential origin tag
	oauthOriginEnv: string; // credential origin tag
	oauthOriginCustomProvider: string; // credential origin tag
	logoutAccountTitleFmt: string; // "Select %s account to log out", %s = provider name
	logoutAccountActiveTag: string; // " (active)"
	logoutAccountEmpty: string; // "No stored accounts to log out"
	logoutAccountFooterHint: string; // "↑/↓ select · ↵ log out account · Esc cancel"
	resetUsageTitle: string; // "Spend a saved rate-limit reset"
	resetUsageActiveTag: string; // " (active)"
	resetUsageCountOne: string; // "%d saved reset"
	resetUsageCountMany: string; // "%d saved resets"
	resetUsageEmpty: string; // "No Codex accounts with saved resets"
	resetUsageConfirmFmt: string; // "Press Enter again to spend 1 reset for %s, Esc to cancel", %s = account label
	resetUsageFooterHint: string; // "↑/↓ select · ↵ spend a reset · Esc cancel"
	resetUsageNoneLeft: string; // "That account has no saved resets to spend."
	queueModeTitle: string; // "Queue Mode"
	queueModeOneByOneDesc: string; // "Process queued messages one by one (recommended)"
	queueModeAllDesc: string; // "Process all queued messages at once"
	showImagesTitle: string; // "Show Images"
	showImagesYesDesc: string; // "Show images inline in terminal"
	showImagesNoDesc: string; // "Show text placeholder instead"
	themeSelectorTitle: string; // "Theme"
	themeSelectorCurrent: string; // "(current)"
	thinkingSelectorTitle: string; // "Thinking Level"
	sessionInfoTitle: string; // "Session Info"
	sessionInfoFooterHint: string; // "↑/↓ scroll · Esc close"
	planReviewTitle: string; // "Plan Review" (top border)
	planReviewEscCancel: string; // "esc cancel"
	planReviewEnterSave: string; // "enter save"
	planReviewHelpSelect: string; // "↑↓ select"
	planReviewHelpConfirm: string; // "⏎ confirm"
	planReviewHelpModel: string; // "◂▸ model"
	planReviewHelpSection: string; // "↑↓ section"
	planReviewHelpOpen: string; // "⏎ open"
	planReviewHelpAnnotate: string; // "a annotate"
	planReviewHelpDelete: string; // "d delete"
	planReviewHelpUndo: string; // "u undo"
	planReviewHelpScroll: string; // "↑↓ scroll"
	planReviewHelpFaster: string; // "⇧ faster"
	planReviewHelpEnds: string; // "g/G ends"
	planReviewHelpCopy: string; // "c copy"
	planReviewHelpRegions: string; // "tab regions"
	planReviewHelpEditorFmt: string; // "%s editor", %s = external editor key label
	planReviewSubmitting: string; // "Submitting…"
	planReviewSubmittingFmt: string; // "%s — submitting…", %s = committed choice label
	planReviewApplying: string; // "Applying your selection — …"
	planReviewFeedbackHeader: string; // "Refinement feedback on the plan:"
	planReviewFeedbackRemoveHeader: string; // "Remove these sections:"
	planReviewPlanPreamble: string; // "Plan preamble"
	planReviewFeedbackLineFmt: string; // "> Line: %s", %s = quoted line context
	planReviewAnnotate: string; // "Annotate" caption
	planReviewNotePrefix: string; // "note: " callout prefix
	planSaveTitle: string; // "Save and quit"
	planSaveFooterHint: string; // "Enter save and quit · Esc cancel"
	moveTitle: string; // "Move to directory"
	moveNoMatchingDirectories: string; // "No matching directories"
	moveFooterHint: string; // "Type to filter · ↑↓ navigate · Tab accept · Enter confirm · Esc cancel"
	copyTitle: string; // "Copy" header
	copySubtitle: string; // "pick what to put on the clipboard"
	copyBlocksCaptionOne: string; // "%d block →"
	copyBlocksCaptionMany: string; // "%d blocks →"
	copyMoreLinesFmt: string; // "… +%d more lines"
	copyLineCountOne: string; // "%d line"
	copyLineCountMany: string; // "%d lines"
	copyControlCopy: string; // clickable control
	copyControlOpen: string; // clickable control
	copyHintOpen: string; // "o open"
	copyFooterUpDownBlock: string; // "↑/↓ block"
	copyFooterBack: string; // "←/esc back"
	copyFooterEnterCopy: string; // "enter copy"
	copyFooterClick: string; // "click"
	copyFooterStep: string; // "↑/↓ step"
	copyFooterBlocks: string; // "→ blocks"
	copyFooterEarlierTurns: string; // "a earlier turns"
	copyFooterExpand: string; // "ctrl+o expand"
	copyFooterClose: string; // "esc close"
	copyBlockCode: string; // block kind label
	copyBlockLangCodeFmt: string; // "%s code", %s = language
	copyBlockQuote: string; // block kind label
	copyBlockLink: string; // block kind label
	copyBlockBashCommand: string; // block kind label
	copyBlockEvalCode: string; // block kind label
	copyBlockCommand: string; // block kind label
	copyBlockOutput: string; // block kind label
	copyBlockResultFmt: string; // "%s result", %s = tool name
	copyBlockUserMessage: string; // turn label
	copyBlockAssistantMessage: string; // turn label
	copyBlockBashExecution: string; // turn label
	copyBlockEvalExecution: string; // turn label
	copyBlockSummary: string; // turn label
	copyBlockMessage: string; // turn label
	copyBlockTurnContent: string; // turn label
	errorBannerDismissHint: string; // "Dismissed when you send your next message."
	pauseTitle: string; // "P A U S E D"
	pauseBodyLine1: string; // "Main agent, subagents, and advisor hold at their next step."
	pauseBodyLine2: string; // "In-flight calls finish; nothing new starts until you resume."
	pauseElapsedFmt: string; // "paused for %s", %s = clock
	pauseEscToResume: string; // "esc to resume"
	pauseResumeHint: string; // "esc · enter · space — resume"
	fireworksTitleWeekly: string; // " O P E N A I   R E S E T " banner
	fireworksTitleSaved: string; // " S A V E D   R E S E T " banner
	fireworksSubtitleWeekly: string; // "Weekly usage cleared early · ESC to return"
	fireworksBankedOneFmt: string; // "New reset banked · %d available · ESC to return"
	fireworksBankedManyFmt: string; // "%d resets banked · %d available · ESC to return"
	tinyDlPreparing: string; // "Preparing"
	tinyDlFailed: string; // "Failed"
	tinyDlReady: string; // "Ready"
	tinyDlDownloaded: string; // "Downloaded"
	tinyDlDownloading: string; // "Downloading"
	tinyModelLabel: string; // "Tiny model"
	composerShapeBandLabel: string; // "Status Band (Default)"
	composerShapeBandDesc: string;
	composerShapeBoxLabel: string; // "Rounded Box"
	composerShapeBoxDesc: string;
	composerShapeClaudeLabel: string; // "Claude Code"
	composerShapeClaudeDesc: string;
	composerShapePiLabel: string; // "Pi"
	composerShapePiDesc: string;
	composerShapeBorderlessLabel: string; // "Borderless"
	composerShapeBorderlessDesc: string;
	composerShapeRuleLabel: string; // "Top Rule Dock"
	composerShapeRuleDesc: string;
	composerShapeFieldLabel: string; // "Compact Field"
	composerShapeFieldDesc: string;
	composerShapeRailLabel: string; // "Accent Rail"
	composerShapeRailDesc: string;
	selectListNoMatching: string; // "No matching items"
	selectListEmpty: string; // "No items"
	settingsListEmpty: string; // "No settings available"
	settingsListBackspaceHint: string; // "Backspace to edit search · Esc to cancel"
	settingsListJumpSections: string; // "PgUp/PgDn to jump sections"
	settingsListFooterSuffix: string; // "Type to search · Esc to cancel"
	formValueRequired: string; // "A value is required."
	// ── Model picker (model-picker.ts) ──────────────────────────────────────
	mpTitle: string; // "Switch Model"
	mpTaskTitle: string; // "Switch Task Model"
	mpStatusHint: string; // "Session-only switch — role models stay unchanged"
	mpQuickRoleStatusHint: string;
	mpTaskStatusHint: string;
	mpFooterHint: string;
	mpQuickRoleFooterHint: string;
	mpTaskFooterHint: string;
	mpSessionModelWord: string; // "session model"
	mpTaskModelWord: string; // "task model"
	mpNoQuickRoles: string;

	// ── Model hub (model-hub.ts) ────────────────────────────────────────────
	mhModelsTitle: string; // "Models" (frame title)
	mhRolesLabel: string; // "Roles" (sidebar)
	mhMinutesAgoFmt: string; // "%sm ago"
	mhNoMatchInProviderFmt: string; // %s = provider label
	mhCachedPendingFmt: string; // %s = age
	mhDiscoveryFailedFmt: string; // %s = error
	mhDiscovery404Fmt: string; // %s = endpoint
	mhApplying: string;
	mhPickingFallbackFmt: string; // %s = verb, %s = label
	mhAssigningFmt: string; // %s = label
	mhRecentStatusFmt: string; // %s = --models scope suffix
	mhNotConfiguredFmt: string; // %s = provider
	mhRefreshingFmt: string; // %s = provider
	mhProviderModelsFmt: string; // %s = provider, %s = count, %s = scope suffix
	mhAllAvailableFmt: string; // %s = scope suffix
	mhFallbacksChipFmt: string; // "fallbacks:%s"
	mhForChipFmt: string; // "for %s"
	mhNewRoleRow: string; // "+ New role…"
	mhNewFallbackRow: string; // "+ New fallback…"
	mhAutoFmt: string; // "auto → %s"
	mhMoreAboveFmt: string; // "↑ %s more"
	mhMoreBelowFmt: string; // "↓ %s more"
	mhCycleTitleFmt: string; // %s = cycle key
	mhCycleEmptyFmt: string; // %s = cycle key
	mhNoCredentialsFmt: string; // %s = provider
	mhLoginWithOauth: string;
	mhCatalogCountFmt: string; // %s = count
	mhThinkingRowSuffix: string; // " · t thinking"
	mhRolesThinkingHintFmt: string; // %s = thinking suffix
	mhMainHintFmt: string; // %s = arrows, %s = refresh suffix

	// ── Model browser (model-browser.ts) ───────────────────────────────────
	mbNoMatchingModels: string;
	mbNoModelsInScope: string;

	// ── Session selector (session-selector.ts) ─────────────────────────────
	ssEmptyNoSessions: string; // "No sessions found" (no indent)
	ssEmptyNoFolderSessions: string; // no indent
	ssLoadingProjects: string; // "Loading all projects…" (no indent)
	ssCurrentMark: string; // "current"
	ssTitleWithScopeFmt: string; // "%s (%s)"
	ssFooterHintLineFmt: string; // "[Del/⌫ delete · Enter select · Tab %s · Esc cancel]"

	// ── History search (history-search.ts) ─────────────────────────────────
	hsTitle: string; // "History"
	hsNoMatchingHistory: string;
	hsNoHistoryYet: string;
	hsHintNavigate: string;
	hsHintSelect: string;
	hsHintCancel: string;
	hsRelativeNow: string; // "now"

	// ── Session tree selector (tree-selector.ts) ───────────────────────────
	tselPanelTitle: string; // "Session Tree" (no indent)
	tselEmptyEntries: string; // "No entries found" (no indent)
	tselNoMatchBareFmt: string; // 'No entries match search "%s"'
	tselBackspaceHint: string; // no indent
	tselFilterDefault: string; // "[default]"
	tselEntriesHiddenFmt: string; // %s = count, %s = filter label
	tselAltShowAllHint: string; // no indent
	tselHelpHintFull: string; // long help line with Alt+↑/↓ and PgUp/PgDn

	// ── Rewind selector (rewind-selector.ts) ───────────────────────────────
	rwTitle: string; // "Rewind"
	rwSubtitle: string;
	rwHintBranches: string; // "←/→ branches"
	rwHintTurns: string; // "←/→ user turns"
	rwFooterFmt: string; // %s = lateral hint
	rwCurrentColumn: string; // "current"

	// ── Usage dashboard (usage-dashboard.ts) ───────────────────────────────
	udDetailsTitle: string; // "Usage · Details"
	udNoLimits: string; // "no limits"
	udAccountsFmt: string; // "%s accts"
	udNoData: string; // "no data"
	udMoreFmt: string; // "+%s more"
	udUntouchedFmt: string; // "untouched: %s"
	udHistoryUnavailable: string;
	udHistoryUnavailableFmt: string; // %s = detail
	udHistoryLoading: string;
	udActivityTitle: string; // "Activity"
	udActivitySummaryFmt: string; // %s = cost, %s = requests, %s = weeks
	udSyncingSuffix: string; // " · syncing…"
	udCheckedAgoFmt: string; // "checked %s ago"
	udScrollHint: string; // "↑/↓ scroll · "
	udDetailHint: string; // "Esc back"
	udOverviewHint: string; // "↵ details · Esc close"

	// ── agents hub (agents-hub.ts) ─────────────────────────────────────────
	agentsHubTitle: string; // "Agents" (frame title)
	agentsHubSourceProject: string; // sidebar source label
	agentsHubSourceUser: string; // sidebar source label
	agentsHubSourceBundled: string; // sidebar source label
	agentsHubAllAgents: string; // sidebar "All agents"
	agentsHubNewAgent: string; // sidebar "New agent"
	agentsHubNewAgentRow: string; // list row "+ New agent…"
	agentsHubNoModels: string; // model browser empty state
	agentsHubSelectToInspect: string; // detail placeholder (also agent-hub)
	agentsHubSearchLabel: string; // "search:"
	agentsHubSessionModel: string; // "session model" (no parens)
	agentsHubModelNoticeFmt: string; // "%s model: %s%s"
	agentsHubPrewalkOnFmt: string; // "%s prewalk: on (%s)"
	agentsHubPrewalkOffFmt: string; // "%s prewalk: off"
	agentsHubAdvisorOnFmt: string; // "%s advisor: on (%s)"
	agentsHubAdvisorOffFmt: string; // "%s advisor: off"
	agentsHubAuto: string; // model summary "auto"
	agentsHubChipEnable: string; // enable chip
	agentsHubChipDisable: string; // disable chip
	agentsHubPropertyModel: string; // property word "model"
	agentsHubPropertyPrewalk: string; // property word "prewalk"
	agentsHubPropertyAdvisor: string; // property word "advisor"
	agentsHubPickModel: string; // "pick model…" chip
	agentsHubPattern: string; // "pattern…" chip
	agentsHubClearOverride: string; // "clear override" chip
	agentsHubCreatedFmt: string; // "Created agent %s at %s"
	agentsHubModelOverride: string; // "model override"
	agentsHubPropertyModelFmt: string; // "%s model"
	agentsHubPickingFmt: string; // " Picking %s for %s — Enter assigns, Esc cancels"
	agentsHubCreateStatus: string; // create-flow status row
	agentsHubSourceScopeFmt: string; // "%s agents" count row
	agentsHubPrewalkBadgeFmt: string; // "pre:%s" list badge
	agentsHubAdvisorBadgeFmt: string; // "adv:%s" list badge
	agentsHubReviewTitle: string; // " Review generated agent"
	agentsHubIdentifierFmt: string; // " Identifier: %s"
	agentsHubScopeFmt: string; // " Scope: %s"
	agentsHubMoreLinesFmt: string; // "   … %s more lines"
	agentsHubCreateTitle: string; // " Create new agent"
	agentsHubCreatePromptFmt: string; // " Describe what the agent should do; scope: %s"
	agentsHubGenerating: string; // "Generating…"
	agentsHubPatternValueModel: string; // "a model pattern"
	agentsHubPatternValueStates: string; // '"on", "off", or a model pattern'
	agentsHubPatternHintFmt: string; // pattern input hint, %s = value kinds
	agentsHubStripApplyHint: string; // property strip footer
	agentsHubStripOpenHint: string; // agent strip footer
	agentsHubAssignHint: string; // model browser footer
	agentsHubReviewHint: string; // review footer
	agentsHubCreateHint: string; // create editor footer
	agentsHubScopeHint: string; // sidebar focus footer
	agentsHubListHint: string; // list focus footer
	agentsHubPatternLabelFmt: string; // "%s %s pattern:" input label

	// ── agent hub (agent-hub.ts / agent-activity.ts) ───────────────────────
	agentHubTitle: string; // "Agent Hub" (also transcript viewer header)
	agentHubActivity: string; // "Activity" section tab
	agentHubStatusRunning: string; // status word (also agent-activity/viewer)
	agentHubStatusIdle: string; // status word
	agentHubStatusParked: string; // status word
	agentHubStatusAborted: string; // status word
	agentHubScopeAll: string; // "all agents"
	agentHubScopeSelected: string; // "selected agent"
	agentHubSelectedWord: string; // "selected" subtree fallback
	agentHubScopeSubtreeFmt: string; // "%s subtree"
	agentHubSearchFmt: string; // "search: %s"
	agentHubSearchEmpty: string; // "search: —"
	agentHubFilterAll: string; // activity filter word
	agentHubFilterErrors: string; // activity filter word
	agentHubFilterResponses: string; // activity filter word
	agentHubFilterTools: string; // activity filter word
	agentHubFollowing: string; // follow state word
	agentHubPaused: string; // follow state word
	agentHubNoMatch: string; // activity empty (filtered)
	agentHubNoActivity: string; // activity empty
	agentHubEarlierFmt: string; // "… %s earlier"
	agentHubActivityFooter: string; // activity footer key strip
	agentHubTitleAgentFmt: string; // "Agent Hub · %s" (narrow title)
	agentHubViewByParent: string; // footer toggle word
	agentHubViewFlat: string; // footer toggle word
	agentHubFooterDetailsFmt: string; // narrow details footer, %s = filter, view
	agentHubFooterNarrowFmt: string; // narrow footer, %s = filter, view
	agentHubFooterWideFmt: string; // wide footer, %s = filter, view
	agentHubLoadingSaved: string; // "Loading saved agents…"
	agentHubEmptyTitle: string; // empty state heading
	agentHubEmptyDetail: string; // empty state detail
	agentHubEmptyHint: string; // empty state hint
	agentHubMoreFmt: string; // "… %s more"
	agentHubViewFlatChip: string; // "Flat" summary chip
	agentHubViewByParentChip: string; // "By parent" summary chip
	agentHubRoster: string; // "Roster" summary heading
	agentHubUsageNone: string; // "Usage —" (zero measured)
	agentHubMeasuredFmt: string; // "%s/%s measured"
	agentHubAgentTimeFmt: string; // "%s agent time"
	agentHubAgentTimeNone: string; // "agent time —"
	agentHubReqFmt: string; // "%s req"
	agentHubToolsFmt: string; // "%s tools"
	agentHubTokFmt: string; // "%s tok"
	agentHubTimedFmt: string; // "%s/%s timed"
	agentHubSectionTask: string; // detail section
	agentHubSectionCurrent: string; // detail section
	agentHubSectionUsage: string; // detail section
	agentHubSectionLineage: string; // detail section
	agentHubSectionChanges: string; // detail section
	agentHubSectionRecent: string; // detail section
	agentHubActiveFmt: string; // "active %s"
	agentHubRetryFmt: string; // "retry %s/%s"
	agentHubUsageDash: string; // "usage —" (detail)
	agentHubSpawnedByFmt: string; // "Spawned by %s"
	agentHubChildrenFmt: string; // " · %s children"
	agentHubRegisteredFmt: string; // "Registered %s"
	agentHubReadOnlyLoc: string; // "Read-only · 0 LoC"
	agentHubSharedWorkspace: string; // "Shared workspace · per-agent LoC not attributable"
	agentHubOutputFmt: string; // "Output %s"
	agentHubPatchFmt: string; // "Patch %s"
	agentHubNestedPatchFmt: string; // "Nested patch %s"
	agentHubWorktreeFmt: string; // "Worktree branch %s"
	agentHubNoRecentActivity: string; // "No response or tool activity yet"
	agentHubReadOnly: string; // advisor badge "read-only"
	agentHubUsageWord: string; // metadata fallback "usage"
	agentHubAdvisorReviveFmt: string; // revive notice
	agentHubNotParkedFmt: string; // revive notice, %s = id, status
	agentHubAdvisorKillFmt: string; // kill notice
	agentActivityFallback: string; // "Agent activity" summary fallback
	agentActivityResponse: string; // "Response" activity title

	// ── agent transcript viewer (agent-transcript-viewer.ts) ───────────────
	transcriptOfFmt: string; // "of %s" (parent tag)
	transcriptFooterEditorFmt: string; // footer hint with editor, %s = expand key
	transcriptFooterFmt: string; // footer hint without editor, %s = expand key
	transcriptHostUnavailable: string; // remote placeholder
	transcriptNoMessages: string; // empty placeholder
	transcriptLoadingRemote: string; // remote loading placeholder
	transcriptNoSessionFile: string; // no-session placeholder

	// ── ask dialog (ask-dialog.ts) ─────────────────────────────────────────
	askSubmitOption: string; // "Submit" tab + row (display mapping of sentinel)
	askDialogTitle: string; // "Ask" panel title
	askDialogTitleFmt: string; // "Ask (%ds)"
	askReviewAnswers: string; // "Review answers" header
	askCancelFmt: string; // "%s cancel" footer fragment
	askEnterSubmit: string; // "Enter submit"
	askUpDownScroll: string; // "↑/↓ scroll"
	askUpDownMove: string; // "↑/↓ move"
	askHintSelect: string; // "Enter select · n note"
	askSpaceToggleNext: string; // "Space toggle · Enter next"
	askSpaceToggleSubmit: string; // "Space toggle · Enter submit"
	askExpandWord: string; // "expand"
	askCollapseWord: string; // "collapse"
	askUnanswered: string; // "unanswered" summary word
	askOtherAnswerFmt: string; // "Other: “%s”"
	askCustomAnswerPrompt: string; // "Custom answer: " prompt title prefix
	askNotePromptFmt: string; // "Note for %s: " prompt title prefix
	askUnansweredWarnOne: string; // "%d unanswered question; Enter still submits."
	askUnansweredWarnMany: string; // "%d unanswered questions; Enter still submits."
	askScrollIndicatorFmt: string; // " %s scroll ·"
	askCancelWord: string; // "cancel" word (also btw footer)

	// ── btw panel + history (btw-panel.ts / btw-history-panel.ts) ──────────
	btwCopiedBadge: string; // "✓ Copied" title suffix
	btwEscToCancel: string; // running footer
	btwCopyAgain: string; // "c to copy again"
	btwCopy: string; // "c to copy"
	btwFollowUpHint: string; // "f to follow up"
	btwBranchHint: string; // "b to branch"
	btwEscToClose: string; // "Esc to close"
	btwCopiedToClipboard: string; // "✓ Copied to clipboard" (both panels)
	btwBranching: string; // "Branching to chat…"
	btwCancelledClose: string; // "Cancelled · Esc to close"
	btwErrorClose: string; // "Error · Esc to close"
	btwWaitingForResponse: string; // "Waiting for response…" (both panels)
	btwNoTextReturned: string; // "No text returned."
	btwStatusRunning: string; // history status word
	btwStatusComplete: string; // history status word
	btwStatusError: string; // history status word
	btwStatusInterrupted: string; // history status word
	btwFollowUpPrompt: string; // composer input prompt
	btwNoticeEmptyQuestion: string; // composer notice
	btwNoticeBusy: string; // composer notice
	btwNoticeStarting: string; // composer notice
	btwNoticeNotStarted: string; // composer notice
	btwNoticeStartFailed: string; // composer notice
	btwEmptyList: string; // list empty state
	btwEmptyDetail: string; // detail empty state
	btwQuestionLabel: string; // "Question" heading
	btwAnswerLabel: string; // "Answer" heading
	btwNoAnswerText: string; // "No answer text."
	btwNotResumed: string; // "Not resumed in this view."
	btwHistoryCountFmt: string; // "History (%s)" pane label
	btwDetailsLabel: string; // "Details" pane label
	btwPanelTitle: string; // "BTW history" frame title
	btwActStarting: string; // footer action word
	btwActSend: string; // footer action word
	btwActClose: string; // footer action word
	btwActSwitchPane: string; // footer action word
	btwActFollowUp: string; // footer action word
	btwCopiedAgain: string; // "✓ copied · c to copy again"
	btwActCopy: string; // footer action word
	btwActCopyAnswer: string; // footer action word
	btwActSelect: string; // navigation word
	btwActScroll: string; // navigation word
	btwTopicFmt: string; // "Topic: %s" composer line
	overlayUnknownError: string; // "Unknown error" (btw + omfg panels)

	// ── cleanse panel (cleanse-panel.ts) ───────────────────────────────────
	cleanseFooterRunning: string; // "Esc cancel /cleanse"
	cleanseFooterClean: string; // "Clean · Esc dismiss"
	cleanseFooterUnresolved: string; // "Diagnostics remain · Esc dismiss"
	cleanseFooterUnsupported: string; // "No runnable checker · Esc dismiss"
	cleanseFooterCancelled: string; // "Cancelled · Esc dismiss"
	cleanseFooterError: string; // "Error · Esc dismiss"

	// ── omfg panel (omfg-panel.ts) ─────────────────────────────────────────
	omfgStatusGenerating: string; // default status line
	omfgFooterCancel: string; // "Esc cancel /omfg"
	omfgFooterSavedFmt: string; // "Registered live · %s · Esc dismiss"
	omfgSavedPathFallback: string; // "saved" path fallback word
	omfgFooterRejected: string; // "Not saved · Esc dismiss"
	omfgFooterAborted: string; // "Cancelled · Esc dismiss"
	omfgFooterError: string; // "Error · Esc dismiss"
	omfgWaitingRule: string; // "Waiting for candidate rule…"

	// ── advisor config extras (advisor-config.ts) ──────────────────────────
	adEnabledLabel: string; // preview "Enabled:"
	adEnabledFieldLabel: string; // detail "Enabled"
	adTokensInFmt: string; // "%s in"
	adTokensOutFmt: string; // "%s out"
	adTokensCacheFmt: string; // "%s cache"
	adCostFmt: string; // "  Cost: $%s"
	adContextFmt: string; // "  Context: %s/%s (%s%)"
	adConfigProblems: string; // pinned warnings header
	adScopeHelpFmt: string; // scope help, %s = localized scope word
	adScopeItemFmt: string; // "Scope: %s" list item
	adErrPrefixFmt: string; // "Advisor config: %s" notify prefix
	adNameHint: string; // name editor footer
	adModelHint: string; // model picker footer
	adThinkingHintFmt: string; // thinking picker footer
	adInstructionsTitleFmt: string; // "Instructions — %s" editor title
	adMoreBelowFmt: string; // "  ↓ %s more" preview marker
	adQuotaUsedFmt: string; // "%s: %s used"
	adQuotaResetsWord: string; // "resets"
	adQuotaTitleFmt: string; // "Quota: %s"
	adQuotaResetsInFmt: string; // "%s in %s"
}

export { M } from "./index";
