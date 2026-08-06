/**
 * Sample avatar and sample conversation for first-use demos.
 *
 * Pure, jsdom-safe. Provides a ready-made avatar identity and a short 2–3 turn
 * dialogue in Chinese so the onboarding UI can show what a finished digital
 * human looks like without any live service.
 */

/** A single message in the sample dialogue. */
export interface SampleMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface SampleAvatar {
  readonly name: string;
  readonly tagline: string;
  readonly voice: string;
  readonly avatar: string;
}

/** A sample avatar identity, all in Chinese. */
export function sampleAvatar(): SampleAvatar {
  return {
    name: "小柯",
    tagline: "你的数字人助手，随时为你答疑解惑。",
    voice: "温暖明亮",
    avatar: "数字人形象（示例）",
  };
}

/** A short 2–3 turn sample dialogue in Chinese. */
export function sampleConversation(): readonly SampleMessage[] {
  return [
    {
      role: "user",
      text: "你好，你是谁？",
    },
    {
      role: "assistant",
      text: "你好，我是你的数字人助手小柯，很高兴见到你。",
    },
    {
      role: "user",
      text: "今天可以帮我做些什么？",
    },
    {
      role: "assistant",
      text: "我可以帮你解答问题、整理信息，也可以陪你聊聊天。",
    },
  ];
}