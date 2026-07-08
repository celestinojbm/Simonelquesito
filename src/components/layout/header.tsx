import Link from "next/link";
import Image from "next/image";
import { SearchBar } from "./search-bar";
import { CartButton } from "./cart-button";

export function Header({
  open,
  hoursLabel,
  brandName,
  brandTagline,
}: {
  open: boolean;
  hoursLabel: string;
  brandName: string;
  brandTagline: string;
}) {
  return (
    <header className="sticky top-0 z-40 bg-brand shadow-md">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2" aria-label={`Inicio ${brandName}`}>
          <Image src="/icons/logo.svg" alt="" width={40} height={40} priority />
          <div className="hidden leading-tight sm:block">
            <span className="block text-lg font-extrabold text-cream">{brandName}</span>
            <span className="block text-xs text-brand-soft">{brandTagline}</span>
          </div>
        </Link>
        <div className="min-w-0 flex-1">
          <SearchBar />
        </div>
        <CartButton />
      </div>
      <div className="bg-brand-dark px-4 py-1.5 text-center text-xs font-medium text-brand-soft">
        {open ? (
          <>🟢 Domicilios abiertos · hoy {hoursLabel}</>
        ) : (
          <>🌙 Domicilios cerrados ahora · horario de hoy {hoursLabel}</>
        )}
      </div>
    </header>
  );
}
