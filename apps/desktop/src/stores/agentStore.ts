import { create } from "zustand";
import type { ChatSession, ChatMessage } from "@trpg-workbench/shared-schema";

export interface AgentState {
  // Chat
  session: ChatSession | null;
  messages: ChatMessage[];
  isTyping: boolean;

  // Actions
  setSession: (s: ChatSession | null) => void;
  addMessage: (m: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;
  setTyping: (v: boolean) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  session: null,
  messages: [],
  isTyping: false,

  setSession: (s) => set({ session: s }),
  addMessage: (m) => set((st) => ({ messages: [...st.messages, m] })),
  setMessages: (msgs) => set({ messages: msgs }),
  setTyping: (v) => set({ isTyping: v }),
}));
