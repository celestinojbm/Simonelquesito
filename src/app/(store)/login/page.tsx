import { LoginForm } from "./login-form";

export const metadata = { title: "Ingresar" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-4 text-center text-xl font-extrabold text-ink">Ingresar</h1>
      <LoginForm />
      <div className="mt-6 rounded-card border border-brand-soft bg-white p-4 text-xs text-ink-soft">
        <p className="mb-1 font-bold text-ink">Cuentas de demostración (contraseña: demo1234)</p>
        <ul className="space-y-0.5">
          <li>owner@marketcastilla.demo — propietario</li>
          <li>admin@marketcastilla.demo — administrador</li>
          <li>cajero@marketcastilla.demo — cajero</li>
          <li>preparador@marketcastilla.demo — preparador</li>
          <li>domiciliario@marketcastilla.demo — domiciliario</li>
          <li>contador@marketcastilla.demo — contador (solo lectura)</li>
          <li>agencia@marketcastilla.demo — admin técnico</li>
          <li>cliente@marketcastilla.demo — cliente</li>
        </ul>
      </div>
    </div>
  );
}
