const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"

export const CONFIRM_CODE_LENGTH = 6

export function confirmCodeFromBytes(bytes: Uint8Array) {
  let code = ""
  for (let index = 0; index < CONFIRM_CODE_LENGTH; index += 1) {
    code += ALPHABET[(bytes[index] || 0) % ALPHABET.length]
  }
  return code
}

export function isConfirmCode(value: string) {
  return new RegExp(`^[${ALPHABET}]{${CONFIRM_CODE_LENGTH}}$`).test(value)
}

export function confirmLinkPath(code: string) {
  return `/c/${code}`
}
