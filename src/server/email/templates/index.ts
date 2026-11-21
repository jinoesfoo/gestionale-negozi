// Modelli delle email, in italiano (01 FON-T10): ogni modello dà oggetto, testo semplice e HTML. Le aree aggiungono i
// loro modelli qui, con il tipo dei dati che ricevono; i segreti (link con token) arrivano a parte, già aperti dal
// lavoro `email.send` (00 §4.3).
import { emailSuppressed, type EmailSuppressedInput } from './email-suppressed';
import { prova, type ProvaInput } from './prova';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** I dati (e i segreti) di ciascun modello. */
export interface TemplateInputs {
  'email-suppressed': EmailSuppressedInput;
  prova: ProvaInput;
}

export type TemplateName = keyof TemplateInputs;

const TEMPLATES: { [K in TemplateName]: (input: TemplateInputs[K]) => RenderedEmail } = {
  'email-suppressed': emailSuppressed,
  prova,
};

export const TEMPLATE_NAMES: readonly TemplateName[] = Object.keys(TEMPLATES) as TemplateName[];

export function isTemplateName(name: unknown): name is TemplateName {
  return typeof name === 'string' && Object.hasOwn(TEMPLATES, name);
}

/** Compone l'email del modello; un modello sconosciuto è un errore. */
export function renderEmail<T extends TemplateName>(template: T, input: TemplateInputs[T]): RenderedEmail {
  if (!isTemplateName(template)) throw new Error(`Modello email sconosciuto: ${String(template)}.`);
  const render = TEMPLATES[template] as (input: TemplateInputs[T]) => RenderedEmail;
  return render(input);
}
