import { create } from "zustand";
import type { ChatSession, ChatMessage } from "@trpg-workbench/shared-schema";

export interface AgentState {
  // Chat
  session: ChatSession | null;
  sessions: ChatSession[];
  messages: ChatMessage[];
  isTyping: boolean;

  // Actions
  setSession: (s: ChatSession | null) => void;
  setSessions: (ss: ChatSession[]) => void;
  setActiveSession: (s: ChatSession, msgs: ChatMessage[]) => void;
  addMessage: (m: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setTyping: (v: boolean) => void;
  /** Reset all chat state when switching workspaces. */
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  session: null,
  sessions: [],
  messages: [],
  isTyping: false,

  setSession: (s) => set({ session: s }),
  setSessions: (ss) => set({ sessions: ss }),
  setActiveSession: (s, msgs) => set({ session: s, messages: msgs }),
  addMessage: (m) => set((st) => ({ messages: [...st.messages, m] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setTyping: (v) => set({ isTyping: v }),
  reset: () => set({ session: null, sessions: [], messages: [], isTyping: false }),
}));
