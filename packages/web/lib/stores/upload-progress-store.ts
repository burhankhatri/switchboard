import { create } from "zustand"

export const useUploadProgressStore = create<{
  chats: Record<string, { bytes: number; total: number } | undefined>
  set: (chatId: string, progress?: { bytes: number; total: number }) => void
}>((set) => ({
  chats: {},
  set: (chatId, progress) => set(state => {
    const chats = { ...state.chats }
    if (progress) chats[chatId] = progress
    else delete chats[chatId]
    return { chats }
  }),
}))
