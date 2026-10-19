export function unavailableQuota() {
  return { available: false, source: "none", message: "Официальная квота недоступна: провайдерский API не подключён." }
}
