import { safeError } from "../text.js"

export const protocol = "v1"

export function detectCapabilities(client) {
  return {
    protocol,
    canListModels: typeof client?.model?.list === "function" || typeof client?.provider?.list === "function",
    canSwitchSessionModel: typeof client?.session?.switchModel === "function",
    canUpdateDefaultModel: false,
    canReadUsage: false,
    usageLocation: "none",
  }
}

export function responseData(response) {
  if (response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "error")) {
    if (response.error) throw new Error(safeError(response.error))
    if (Object.prototype.hasOwnProperty.call(response, "data")) return response.data
  }
  return response && typeof response === "object" && Object.prototype.hasOwnProperty.call(response, "data") ? response.data : response
}

export async function call(label, operation, errors) {
  try {
    return responseData(await operation())
  } catch (error) {
    errors.push({ operation: label, error: safeError(error) })
    return null
  }
}
