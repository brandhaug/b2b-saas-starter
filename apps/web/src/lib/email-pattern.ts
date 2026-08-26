/** The email-shape rule shared by every validator that checks a bare address:
 * one pattern, used by both the client form validators and the server
 * function schemas, so neither side accepts what the other refuses. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/
