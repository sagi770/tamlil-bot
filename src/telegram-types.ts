export interface TgUser { id: number; first_name?: string }
export interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
export interface TgFile { file_id: string; file_size?: number; mime_type?: string; file_name?: string; duration?: number }
export interface TgMessage { message_id: number; date: number; chat: TgChat; from?: TgUser; text?: string; caption?: string; voice?: TgFile; audio?: TgFile; video?: TgFile; video_note?: TgFile; document?: TgFile }
export interface TgCallbackQuery { id: string; from: TgUser; data?: string; message?: TgMessage }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }
export type InlineKeyboard = { text: string; callback_data: string }[][];
