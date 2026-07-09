import { Children, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'

export type FlashcardItem = {
  id: string
  category?: string
  content: ReactNode
}

/**
 * One-card-at-a-time deck for dense card collections: swipe (native snap scroll)
 * on touch, arrows/dots/keyboard elsewhere, tap anywhere non-interactive to advance,
 * optional category chips when the cards belong to more than one group.
 */
export function FlashcardDeck({ ariaLabel, cards, className }: { ariaLabel: string; cards: FlashcardItem[]; className?: string }) {
  const [category, setCategory] = useState<string>('All')
  const [activeIndex, setActiveIndex] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const categories = useMemo(() => {
    const unique: string[] = []
    cards.forEach((card) => {
      if (card.category && !unique.includes(card.category)) unique.push(card.category)
    })
    return unique.length > 1 ? ['All', ...unique] : []
  }, [cards])

  const visibleCards = useMemo(
    () => (category === 'All' ? cards : cards.filter((card) => card.category === category)),
    [cards, category],
  )

  // Reset to the first card when the deck contents change (render-phase state adjustment).
  const deckKey = `${category}:${cards.length}`
  const [prevDeckKey, setPrevDeckKey] = useState(deckKey)
  if (deckKey !== prevDeckKey) {
    setPrevDeckKey(deckKey)
    setActiveIndex(0)
  }

  function goTo(index: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    const target = Math.max(0, Math.min(index, visibleCards.length - 1))
    viewport.scrollTo({ left: target * viewport.clientWidth, behavior: 'smooth' })
  }

  function handleScroll() {
    const viewport = viewportRef.current
    if (!viewport || viewport.clientWidth === 0) return
    const index = Math.round(viewport.scrollLeft / viewport.clientWidth)
    if (index !== activeIndex) setActiveIndex(Math.max(0, Math.min(index, visibleCards.length - 1)))
  }

  function handleCardTap(event: MouseEvent<HTMLDivElement>) {
    // Tapping the card flips to the next one, but never hijack real controls inside it,
    // and only the innermost deck responds when decks are nested.
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, select, textarea, [role="button"]')) return
    if (target.closest('.flash-deck-viewport') !== event.currentTarget) return
    goTo(activeIndex + 1 >= visibleCards.length ? 0 : activeIndex + 1)
  }

  if (!cards.length) return null

  return (
    <div aria-label={ariaLabel} aria-roledescription="carousel" className={`flash-deck ${className ?? ''}`} role="group">
      {categories.length > 0 && (
        <div aria-label={`${ariaLabel} categories`} className="flash-deck-chips" role="tablist">
          {categories.map((option) => (
            <button
              aria-selected={category === option}
              className={category === option ? 'active' : ''}
              key={option}
              role="tab"
              type="button"
              onClick={() => {
                setCategory(option)
                viewportRef.current?.scrollTo({ left: 0 })
              }}
            >
              {option}
              <small>{option === 'All' ? cards.length : cards.filter((card) => card.category === option).length}</small>
            </button>
          ))}
        </div>
      )}
      <div
        aria-live="polite"
        className="flash-deck-viewport"
        ref={viewportRef}
        tabIndex={0}
        onClick={handleCardTap}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            goTo(activeIndex + 1)
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            goTo(activeIndex - 1)
          }
        }}
        onScroll={handleScroll}
      >
        {visibleCards.map((card, index) => (
          <div
            aria-hidden={index !== activeIndex}
            aria-label={`Card ${index + 1} of ${visibleCards.length}`}
            className="flash-slide"
            key={card.id}
            role="tabpanel"
          >
            {card.content}
          </div>
        ))}
      </div>
      {visibleCards.length > 1 && (
        <div className="flash-deck-footer">
          <button aria-label="Previous card" disabled={activeIndex === 0} type="button" onClick={() => goTo(activeIndex - 1)}>
            &#8592;
          </button>
          {visibleCards.length <= 12 && (
            <div className="flash-deck-dots" aria-hidden="true">
              {visibleCards.map((card, index) => (
                <button
                  className={index === activeIndex ? 'active' : ''}
                  key={card.id}
                  tabIndex={-1}
                  type="button"
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
          )}
          <span className="flash-deck-counter">
            {activeIndex + 1}/{visibleCards.length}
          </span>
          <button
            aria-label="Next card"
            disabled={activeIndex >= visibleCards.length - 1}
            type="button"
            onClick={() => goTo(activeIndex + 1)}
          >
            &#8594;
          </button>
        </div>
      )}
    </div>
  )
}

/** Deck wrapper for JSX children: each direct child becomes one flash card. */
export function FlashcardStack({ ariaLabel, children, className }: { ariaLabel: string; children: ReactNode; className?: string }) {
  const cards = Children.toArray(children).map((child, index) => ({ id: `card-${index}`, content: child }))
  return <FlashcardDeck ariaLabel={ariaLabel} cards={cards} className={className} />
}
