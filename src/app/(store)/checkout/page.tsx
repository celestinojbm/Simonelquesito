import { listActiveZones } from "@/modules/delivery/service";
import { getSetting } from "@/modules/config/service";
import { getSessionUser } from "@/lib/auth/session";
import { customerForUser } from "@/modules/accounts/service";
import { getCreditStatus } from "@/modules/credit/service";
import { PhoneLogin } from "@/components/account/phone-login";
import { CheckoutForm } from "./checkout-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const [zones, freeFrom, storeLocation, requireAccount, user] = await Promise.all([
    listActiveZones(),
    getSetting("delivery.freeFromCop"),
    getSetting("business.location"),
    getSetting("accounts.requireForCheckout"),
    getSessionUser(),
  ]);
  const customer = user ? await customerForUser(user.id) : null;
  // Cupo de Fiado del cliente (para ofrecer "pagar a crédito" en el checkout).
  const creditStatus = customer ? await getCreditStatus(customer.id) : null;
  const credit =
    creditStatus && creditStatus.account.status === "active"
      ? { availableCop: creditStatus.availableCop, overdue: creditStatus.overdueCount > 0 }
      : null;

  // Cuenta obligatoria (configurable): sin sesión no hay checkout.
  if (requireAccount && !user) {
    return (
      <div className="mx-auto max-w-sm">
        <h1 className="mb-4 text-xl font-extrabold text-ink">Finalizar pedido</h1>
        <PhoneLogin title="Ingresa para completar tu compra" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-extrabold text-ink">Finalizar pedido</h1>
      <CheckoutForm
        zones={zones.map((z) => ({
          id: z.id,
          name: z.name,
          neighborhoods: z.neighborhoods as string[],
          feeCop: z.feeCop,
          minOrderCop: z.minOrderCop,
          etaMinutesMin: z.etaMinutesMin,
          etaMinutesMax: z.etaMinutesMax,
        }))}
        freeFromCop={freeFrom}
        storeLocation={{ lat: storeLocation.lat, lng: storeLocation.lng }}
        defaultContact={
          customer
            ? { name: customer.fullName, phone: customer.phone.replace(/^57/, "") }
            : null
        }
        credit={credit}
        onlineProvider={process.env.PAYMENT_PROVIDER === "mercado_pago" ? "mercado_pago" : "sandbox"}
      />
    </div>
  );
}
