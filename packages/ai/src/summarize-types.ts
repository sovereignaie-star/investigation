/** أنواع مشتركة بين وحدات التلخيص والحقن — بلا مسار شبكة. */
export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface EvidenceStatement {
  readonly text: string;
  readonly evidenceId: string;
}
