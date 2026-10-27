import mark from "../assets/logo-mark.png";

/** Símbolo de KINETIC: un engranaje y un brazo articulado formando la K. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return <img src={mark} alt="" aria-hidden="true" draggable={false} className={className + " shrink-0 object-contain"} />;
}
