"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import { AlertTriangle, ArrowUp, Square, ChevronDown, X, Plus, Pencil, ListChecks, GitBranch } from "lucide-react"
import { cn } from "@/lib/utils"
import { GlassContainer } from "../glass-ui/GlassContainer"
import { DictationControl } from "./DictationControl"
import { MentionMenu, parseMention, useMentionItems, type MentionItem } from "./MentionMenu"
import { useModelSweep } from "./ModelSweep"
import { TextInputArea } from "../glass-ui/TextInputArea"
import { PillButton, IconButton, PrimaryAction } from "../glass-ui/Buttons"
import { useModals } from "@/lib/contexts"
import { useSpeechRecognition } from "@/lib/hooks/useSpeechRecognition"
import type { Chat, Agent, CredentialFlags, PendingFile } from "@/lib/types"
import { NEW_REPOSITORY } from "@/lib/types"
import { PendingFilesDisplay } from "./PendingFilesDisplay"
import { AgentModelSelector } from "./AgentModelSelector"
import { BranchCombobox } from "./BranchCombobox"
import { SlashCommandMenu, type SlashCommandType } from "../SlashCommandMenu"
import { MobileSelect } from "../ui/MobileBottomSheet"

// =============================================================================
// ChatInput - The main chat input area with all controls
// =============================================================================

interface ChatInputProps {
  chat: Chat
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  /** Branch-and-send: create a sibling chat and dispatch there (Cmd/Alt/Ctrl held). */
  onBranchSend?: () => void
  /** Whether branching is currently allowed (drives the send-button modifier affordance). */
  canBranch?: boolean
  onStop: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  // File upload
  pendingFiles: PendingFile[]
  fileContents: Map<string, string>
  fileError: string | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  isDraggingOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onPaste: (e: React.ClipboardEvent) => void
  onAddFiles: (files: FileList) => void
  onRemoveFile: (id: string) => void
  onClearFileError: () => void
  onPreviewFile: (file: PendingFile | null) => void
  getFileTypeForFile: (file: File) => "image" | "pdf" | "text" | "code" | "other"
  getFilePreviewUrl: (file: File) => string | null
  // Slash commands
  slashMenuOpen: boolean
  slashSelectedIndex: number
  onSlashSelect: (command: SlashCommandType) => void
  onSlashClose: () => void
  onSlashSelectedIndexChange: (index: number) => void
  hasLinkedRepo: boolean
  inConflict: boolean
  hasSlashCommands: boolean
  // State flags
  isRunning: boolean
  isCreating: boolean
  isNewChat: boolean
  canSend: boolean
  canQueue: boolean
  // Repo/branch
  showRepoButton: boolean
  isNewRepo: boolean
  canSelectExistingRepo: boolean
  onUpdateChat?: (updates: Partial<Chat>) => void
  /** Default branch for the current repo (used by BranchCombobox) */
  defaultBranch?: string
  // Agent/model
  credentialFlags: CredentialFlags
  currentAgent: Agent
  currentModel: string
  showClaudeLimitDialog: () => void
  // Plan mode
  planModeEnabled: boolean
  planModeSupported: boolean
  onSetPlanMode: (enabled: boolean) => void
  // MCP servers (chat-scoped, draft-aware)
  showMcpButton: boolean
  isDraftChat: boolean
  onMaterializeDraftForMcp: (draftId: string) => Promise<string | null>
  // Mobile
  isMobile: boolean
}

interface ChatActionSlotProps {
  isRunning: boolean
  canQueue: boolean
  canSend: boolean
  isMobile: boolean
  showBranchAffordance: boolean
  onSend: (e?: React.MouseEvent) => void
  onStop: () => void
}

/**
 * Keeps the far-right composer action in a stable, fixed-size slot.
 *
 * The wrapper intentionally remains mounted while idle. Otherwise, when a run
 * finishes, the adjacent microphone control shifts into the Stop button's old
 * hit target and can receive a click that was intended to stop the agent.
 */
export function ChatActionSlot({
  isRunning,
  canQueue,
  canSend,
  isMobile,
  showBranchAffordance,
  onSend,
  onStop,
}: ChatActionSlotProps) {
  return (
    <div
      data-testid="chat-action-slot"
      className={cn(
        "shrink-0 flex items-center justify-center",
        isMobile ? "h-9 w-9" : "h-7 w-7"
      )}
    >
      {isRunning && canQueue ? (
        <button
          type="button"
          onClick={onSend}
          title="Queue message (sent after current response)"
          aria-label="Queue message"
          className={cn(
            "flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
        </button>
      ) : isRunning ? (
        <button
          type="button"
          onClick={onStop}
          title="Stop agent"
          aria-label="Stop agent"
          className={cn(
            "flex items-center justify-center rounded-md bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors cursor-pointer",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          <Square className={cn(isMobile ? "h-3.5 w-3.5" : "h-3 w-3", "fill-current")} />
        </button>
      ) : (
        // Rendered disabled rather than omitted. With nothing to send this used
        // to return null, so the composer's right edge had only the microphone
        // floating against a wide gap and the bar read as unbalanced.
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          title={
            !canSend
              ? undefined
              : showBranchAffordance
                ? "Send to a new branch"
                : undefined
          }
          aria-label={showBranchAffordance ? "Send to a new branch" : "Send message"}
          className={cn(
            "flex items-center justify-center rounded-lg transition-colors",
            canSend
              ? "bg-ink text-white hover:opacity-90 active:scale-[0.94] cursor-pointer"
              : "bg-line-strong text-ink-2 cursor-not-allowed",
            isMobile ? "h-9 w-9" : "h-7 w-7"
          )}
        >
          {showBranchAffordance ? (
            <GitBranch className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          ) : (
            <ArrowUp className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
          )}
        </button>
      )}
    </div>
  )
}

export function ChatInput({
  chat,
  input,
  onInputChange,
  onSend,
  onBranchSend,
  canBranch = false,
  onStop,
  onKeyDown,
  textareaRef,
  // File upload
  pendingFiles,
  fileContents,
  fileError,
  fileInputRef,
  isDraggingOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onPaste,
  onAddFiles,
  onRemoveFile,
  onClearFileError,
  onPreviewFile,
  getFileTypeForFile,
  getFilePreviewUrl,
  // Slash commands
  slashMenuOpen,
  slashSelectedIndex,
  onSlashSelect,
  onSlashClose,
  onSlashSelectedIndexChange,
  hasLinkedRepo,
  inConflict,
  hasSlashCommands,
  // State flags
  isRunning,
  isCreating,
  isNewChat,
  canSend,
  canQueue,
  // Repo/branch
  showRepoButton,
  isNewRepo,
  canSelectExistingRepo,
  onUpdateChat,
  defaultBranch,
  // Agent/model
  credentialFlags,
  currentAgent,
  currentModel,
  showClaudeLimitDialog,
  // Plan mode
  planModeEnabled,
  planModeSupported,
  onSetPlanMode,
  // MCP servers
  showMcpButton,
  isDraftChat,
  onMaterializeDraftForMcp,
  // Mobile
  isMobile,
}: ChatInputProps) {
  const modals = useModals()
  const [showModeDropdown, setShowModeDropdown] = useState(false)
  const [showModeSheet, setShowModeSheet] = useState(false)

  // Whether a "branch" modifier (Cmd/Alt/Ctrl) is currently held. When it is —
  // and branching is possible — the send button turns into a "send to new
  // branch" affordance (branch icon), and clicking it branches instead of
  // sending to the current chat. Mirrors the Cmd/Alt/Ctrl+Enter keybinding.
  const [branchModifierHeld, setBranchModifierHeld] = useState(false)
  useEffect(() => {
    const sync = (e: KeyboardEvent) => {
      setBranchModifierHeld(e.metaKey || e.altKey || e.ctrlKey)
    }
    const clear = () => setBranchModifierHeld(false)
    window.addEventListener("keydown", sync)
    window.addEventListener("keyup", sync)
    // Reset when focus leaves the window so a stuck modifier doesn't persist.
    window.addEventListener("blur", clear)
    return () => {
      window.removeEventListener("keydown", sync)
      window.removeEventListener("keyup", sync)
      window.removeEventListener("blur", clear)
    }
  }, [])
  const showBranchAffordance = branchModifierHeld && canBranch && !!onBranchSend

  // -- Speech-to-text (voice dictation) -------------------------------------
  // Keep the latest input in a ref so the recognition callback (created once
  // per render but invoked asynchronously) always reads the current value.
  const inputRef = useRef(input)
  inputRef.current = input
  // Cursor position to restore after a controlled-state update inserts text.
  const pendingSelectionRef = useRef<number | null>(null)

  const insertTranscript = useCallback((text: string) => {
    const textarea = textareaRef.current
    const current = inputRef.current
    // Determine where to insert: at the caret if focused, else append.
    const hasSelection = textarea && document.activeElement === textarea
    const start = hasSelection ? textarea.selectionStart ?? current.length : current.length
    const end = hasSelection ? textarea.selectionEnd ?? current.length : current.length

    const before = current.slice(0, start)
    const after = current.slice(end)
    // Add a space between existing text and the new chunk when needed.
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
    const insertion = (needsLeadingSpace ? " " : "") + text
    const next = before + insertion + after

    pendingSelectionRef.current = start + insertion.length
    onInputChange(next)
  }, [onInputChange, textareaRef])

  const speech = useSpeechRecognition({ onResult: insertTranscript })

  // Restore the caret after a transcript insertion re-renders the textarea.
  useEffect(() => {
    if (pendingSelectionRef.current === null) return
    const textarea = textareaRef.current
    const pos = pendingSelectionRef.current
    pendingSelectionRef.current = null
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(pos, pos)
  }, [input, textareaRef])

  const toggleListening = useCallback(() => {
    if (speech.isListening) {
      speech.stop()
    } else {
      speech.start()
    }
  }, [speech])

  // Stop dictation when a message is sent. When a branch modifier is held (and
  // branching is possible), send to a new branch instead of the current chat.
  const handleSendWithSpeechStop = useCallback((e?: React.MouseEvent) => {
    if (speech.isListening) speech.stop()
    if ((e?.metaKey || e?.altKey || e?.ctrlKey) && canBranch && onBranchSend) {
      onBranchSend()
      return
    }
    onSend()
  }, [speech, onSend, onBranchSend, canBranch])

  // Close mode dropdown when clicking outside (desktop only)
  useEffect(() => {
    if (isMobile) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-dropdown]')) {
        setShowModeDropdown(false)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMobile])

  // Changing model updates a label and nothing else, so it is easy to be
  // unsure it took. The sweep is the acknowledgement.
  const { canvas: sweepCanvas, play: playSweep } = useModelSweep()
  const lastModel = useRef(currentModel)
  useEffect(() => {
    if (lastModel.current !== currentModel) {
      lastModel.current = currentModel
      playSweep()
    }
  }, [currentModel, playSweep])

  // -- @ mentions ------------------------------------------------------------
  const mention = parseMention(input)
  const mentionQuery = mention?.query ?? ""
  const mentionItems = useMentionItems(mentionQuery)
  const mentionOpen = mention !== null
  const [mentionIndex, setMentionIndex] = useState(0)

  useEffect(() => {
    setMentionIndex(0)
  }, [mentionQuery])

  const applyMention = (item: MentionItem) => {
    if (!mention) return
    onInputChange(`${input.slice(0, mention.start)}@${item.token} `)
    textareaRef?.current?.focus()
  }

  // Runs before the composer's own handler so the mention menu owns the arrow
  // keys while it is open — otherwise Enter would send the message instead of
  // accepting the highlighted row.
  const handleKeyDownWithMentions = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionItems.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex(
          (i) => (i + (e.key === "ArrowDown" ? 1 : mentionItems.length - 1)) % mentionItems.length
        )
        return
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        e.preventDefault()
        applyMention(mentionItems[mentionIndex])
        return
      }
    }
    onKeyDown(e)
  }

  // Mode options for mobile bottom sheet
  const modeOptions = [
    { value: "edit", label: "Edit", icon: <Pencil className="h-5 w-5" /> },
    { value: "plan", label: "Plan", icon: <ListChecks className="h-5 w-5" /> },
  ]

  return (
    <div className={cn(
      "w-full mx-auto",
      isMobile ? "max-w-full" : "max-w-[52rem]"
    )}>
      <GlassContainer
        className={cn(
          "flex flex-col relative",
          isDraggingOver && "border-primary ring-2 ring-primary/30"
        )}
      >
        {sweepCanvas}
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className="absolute inset-0 z-0 rounded-2xl"
        />
        {/* Drop zone overlay */}
        {isDraggingOver && (
          <div className="absolute inset-0 bg-primary/5 rounded-2xl flex items-center justify-center z-10 pointer-events-none">
            <div className="text-primary text-sm font-medium">Drop files here</div>
          </div>
        )}

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="*/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              onAddFiles(e.target.files)
              e.target.value = ""
            }
          }}
        />

        {/* Pending files display */}
        <PendingFilesDisplay
          pendingFiles={pendingFiles}
          fileContents={fileContents}
          getFileTypeForFile={getFileTypeForFile}
          getFilePreviewUrl={getFilePreviewUrl}
          onRemoveFile={onRemoveFile}
          onPreviewFile={onPreviewFile}
          isMobile={isMobile}
        />

        {/* Text input area. The grid below decides whether this sits inline
            with the controls or takes its own full-width row. */}
        <div className="relative z-10 w-full">
          {/* Slash Command Menu */}
          {hasSlashCommands && (
            <SlashCommandMenu
              input={input}
              open={slashMenuOpen}
              onSelect={onSlashSelect}
              onClose={onSlashClose}
              selectedIndex={slashSelectedIndex}
              onSelectedIndexChange={onSlashSelectedIndexChange}
              hasLinkedRepo={hasLinkedRepo}
              inConflict={inConflict}
              isMobile={isMobile}
            />
          )}

          {mentionOpen && (
            <MentionMenu
              items={mentionItems}
              activeIndex={mentionIndex}
              onActiveIndexChange={setMentionIndex}
              onSelect={applyMention}
              query={mentionQuery}
            />
          )}

          <TextInputArea
            textareaRef={textareaRef}
            data-chat-prompt
            data-testid="chat-input"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDownWithMentions}
            onPaste={onPaste}
            placeholder={
              isCreating
                ? "Creating sandbox..."
                : isRunning
                ? "Agent is working..."
                : isNewChat
                ? "Ask"
                : "Enter prompt or /merge..."
            }
          />
        </div>

        {/* File upload error message */}
        {fileError && (
          <div className={cn(
            "relative z-10 flex items-start gap-2 text-destructive bg-destructive/10 rounded-chip",
            isMobile ? "mx-1 mb-1 px-2 py-1.5 text-sm" : "mx-1 mb-1 px-2 py-1.5 text-xs"
          )}>
            <AlertTriangle className={cn("shrink-0 mt-0.5", isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            <span className="flex-1">{fileError}</span>
            <button
              onClick={onClearFileError}
              className="shrink-0 text-destructive/70 hover:text-destructive transition-colors"
              aria-label="Dismiss error"
            >
              <X className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />
            </button>
          </div>
        )}

        {/* Controls row. `relative z-10` is load-bearing: the drag catcher
            above is absolute inset-0, and without a stacking context here it
            covers this row and eats every click. */}
        <div className={cn(
          "relative z-10 flex justify-between items-center w-full gap-1",
          isMobile ? "px-1 pb-0.5" : "px-1 pb-0.5"
        )}>
          {/* Left group */}
          <div className="flex items-center" style={{ gap: '10px' }}>
            {/* Attachment button */}
            <IconButton
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title="Attach files"
              aria-label="Attach files"
              icon={<Plus className={cn(isMobile ? "h-4 w-4" : "h-3.5 w-3.5")} />}
            />

            {/* Repo picker and MCP picker removed: the workspace supplies the
                repo, and its MCP connections are configured on the workspace
                rather than per chat. Offering them here let the composer
                contradict the workspace it runs in. */}


            {/* Mode selector dropdown (Edit/Plan) - only show if agent supports plan mode */}
            {planModeSupported && (
              isMobile ? (
                <>
                  <PillButton
                    onClick={() => setShowModeSheet(true)}
                    title={planModeEnabled ? "Plan mode — agent will plan before acting" : "Edit mode — agent will edit code directly"}
                    icon={planModeEnabled ? <ListChecks className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    label={<span className="hidden sm:inline">{planModeEnabled ? "Plan" : "Edit"}</span>}
                  />
                  <MobileSelect
                    open={showModeSheet}
                    onClose={() => setShowModeSheet(false)}
                    title="Select Mode"
                    options={modeOptions}
                    value={planModeEnabled ? "plan" : "edit"}
                    onChange={(value) => onSetPlanMode(value === "plan")}
                  />
                </>
              ) : (
                <div className="relative" data-dropdown>
                  <PillButton
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation()
                      setShowModeDropdown(!showModeDropdown)
                    }}
                    title={planModeEnabled ? "Plan mode — agent will plan before acting" : "Edit mode — agent will edit code directly"}
                    icon={planModeEnabled ? <ListChecks className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                    label={<span className="hidden sm:inline">{planModeEnabled ? "Plan" : "Edit"}</span>}
                  />
                  {showModeDropdown && (
                    <div className="absolute bottom-full right-0 mb-1 bg-popover/85 backdrop-blur-md border border-border/40 rounded-md shadow-lg py-1 z-50 w-32">
                      <button
                        onClick={() => {
                          onSetPlanMode(false)
                          setShowModeDropdown(false)
                        }}
                        className={cn(
                          "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                          !planModeEnabled && "bg-accent"
                        )}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          onSetPlanMode(true)
                          setShowModeDropdown(false)
                        }}
                        className={cn(
                          "w-full text-left hover:bg-accent active:bg-accent transition-colors flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer",
                          planModeEnabled && "bg-accent"
                        )}
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        Plan
                      </button>
                    </div>
                  )}
                </div>
              )
            )}

            {/* Agent and Model selectors */}
            <AgentModelSelector
              chat={chat}
              credentialFlags={credentialFlags}
              currentAgent={currentAgent}
              currentModel={currentModel}
              onUpdateChat={onUpdateChat}
              showClaudeLimitDialog={showClaudeLimitDialog}
              isMobile={isMobile}
              onDropdownOpen={() => setShowModeDropdown(false)}
              closeDropdowns={showModeDropdown}
            />
          </div>

          {/* Right group */}
          <div className="flex items-center" style={{ gap: '10px' }}>
            {/* Voice dictation */}
            {speech.isSupported && (
              <DictationControl
                isListening={speech.isListening}
                permissionDenied={speech.permissionDenied}
                transcript={speech.transcript}
                error={speech.error}
                onToggle={toggleListening}
                isMobile={isMobile}
              />
            )}

            {/* Send / stop / queue button */}
            <ChatActionSlot
              isRunning={isRunning}
              canQueue={canQueue}
              canSend={canSend}
              isMobile={isMobile}
              showBranchAffordance={showBranchAffordance}
              onSend={handleSendWithSpeechStop}
              onStop={onStop}
            />
          </div>
        </div>
      </GlassContainer>
    </div>
  )
}
