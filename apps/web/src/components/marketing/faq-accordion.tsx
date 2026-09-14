'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

export type FaqItem = { q: string; a: string };

export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="mk-faq">
      {items.map((item, index) => {
        const isOpen = open === index;
        return (
          <div key={item.q} className={isOpen ? 'mk-faq__item is-open' : 'mk-faq__item'}>
            <button
              type="button"
              className="mk-faq__q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : index)}
            >
              <span>{item.q}</span>
              <Plus className="mk-faq__icon" aria-hidden="true" />
            </button>
            {isOpen ? (
              <div className="mk-faq__a">
                <p>{item.a}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
