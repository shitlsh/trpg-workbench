import { create } from "zustand";
import type {
  ChatSession, ChatMessage, WorkflowState,
  ConsistencyReport, PatchProposal,
} from "@trpg-workbench/shared-schema";

export interface AgentState {
  // Chat
  session: ChatSession | null;
  messages: ChatMessage[];
  isTyping: boolean;

  // Active workflow
  activeWorkflow: WorkflowState | null;
  workflowPolling: boolean;

  // Consistency
  consistencyReport: ConsistencyReport | null;

  // Patch confirm dialog
  pendingPatches: PatchProposal[];
  showPatchDialog: boolean;

  // Actions
  setSession: (s: ChatSession | null) => void;
  addMessage: (m: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setTyping: (v: boolean) => void;
  setActiveWorkflow: (wf: WorkflowState | null) => void;
  setWorkflowPolling: (v: boolean) => void;
  setConsistencyReport: (r: ConsistencyReport | null) => void;
  setPendingPatches: (patches: PatchProposal[], show: boolean) => void;
  closePatchDialog: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  session: null,
  messages: [],
  isTyping: false,
  activeWorkflow: null,
  workflowPolling: false,
  consistencyReport: null,
  pendingPatches: [],
  showPatchDialog: false,

  setSession: (s) => set({ session: s }),
  addMessage: (m) => set((st) => ({ messages: [...st.messages, m] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setTyping: (v) => set({ isTyping: v }),
  setActiveWorkflow: (wf) => set({ activeWorkflow: wf }),
  setWorkflowPolling: (v) => set({ workflowPolling: v }),
  setConsistencyReport: (r) => set({ consistencyReport: r }),
  setPendingPatches: (patches, show) => set({ pendingPatches: patches, showPatchDialog: show }),
  closePatchDialog: () => set({ showPatchDialog: false, pendingPatches: [] }),
}));
