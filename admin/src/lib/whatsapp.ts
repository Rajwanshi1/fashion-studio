import type { Order, OrderStatus } from './types';

/**
 * Warm boutique-voiced WhatsApp updates per status. Only statuses worth a
 * client message have one — the send button disables for the rest.
 */
export const STATUS_MESSAGES: Partial<Record<OrderStatus, (o: Order) => string>> = {
  in_atelier: (o) =>
    `Hello ${o.firstName}! Your Tanvi Agnihotry order ${o.orderNumber} is now in process at our atelier. ` +
    `Every piece is finished by hand — we will keep you posted at each step. Warmly, Team TA`,
  quality_check: (o) =>
    `Hello ${o.firstName}! Lovely news — your order ${o.orderNumber} has moved to quality check. ` +
    `Our team is giving it a final press and inspection before it leaves us. Warmly, Team TA`,
  dispatched: (o) =>
    `Hello ${o.firstName}! Your order ${o.orderNumber} has been shipped and is on the way to you. ` +
    `We can't wait for you to unwrap it. Warmly, Team TA`,
  delivered: (o) =>
    `Hello ${o.firstName}! Your order ${o.orderNumber} has been delivered. ` +
    `We hope you love wearing it — thank you for choosing Tanvi Agnihotry. Warmly, Team TA`,
};

/** wa.me deep link — digits only (no +), message URL-encoded. */
export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(text)}`;
}
