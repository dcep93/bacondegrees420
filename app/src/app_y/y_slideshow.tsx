import { type ReactNode, useCallback, useEffect, useState } from "react";
import boxesSrc from "../assets/y/boxes.png";
import constellationSrc from "../assets/y/constellation.png";
import fastBreakSrc from "../assets/y/fast_break.jpg";
import greatnanaSrc from "../assets/y/greatnana.avif";
import infographicSrc from "../assets/y/infographic.png";
import lifeSavingGameScreenshotSrc from "../assets/y/life_saving_game_screenshot.png";
import overlayEndSrc from "../assets/y/overlay_end.png";
import overlayStartSrc from "../assets/y/overlay_start.png";
import poseConstellationSrc from "../assets/y/pose_constellation.png";
import poseSrc from "../assets/y/pose.png";
import "./y_slideshow.css";

type TextBullet = {
  content: ReactNode;
  id: string;
};

type TextSlide = {
  bullets?: TextBullet[];
  kind: "text";
  text?: ReactNode;
};

type ImageSlide = {
  kind: "image";
  src: string;
};

type LinkSlide = {
  href: string;
  kind: "link";
  src: string;
};

type StackItem = {
  content: ImageSlide | LinkSlide | TextSlide;
  id: string;
  isHidden?: boolean;
};

type StackSlide = {
  items: StackItem[];
  kind: "stack";
};

type Slide = ImageSlide | LinkSlide | StackSlide | TextSlide;

function renderTextSlide(slide: TextSlide, className = "y-slideshow__text-slide", key?: string, isHidden = false) {
  return (
    <section aria-hidden={isHidden || undefined} className={className} key={key}>
      {slide.text ? <p>{slide.text}</p> : null}
      {slide.bullets ? (
        <ul>
          {slide.bullets.map((bullet) => (
            <li key={bullet.id}>{bullet.content}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function renderMediaSlide(slide: ImageSlide | LinkSlide, className?: string) {
  return slide.kind === "image" ? (
    <img className={className ? `y-slideshow__image ${className}` : "y-slideshow__image"} src={slide.src} alt="" />
  ) : (
    <a
      aria-label="Open Fast Break (1979)"
      className={className ? `y-slideshow__link-slide ${className}` : "y-slideshow__link-slide"}
      href={slide.href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <img className="y-slideshow__poster" src={slide.src} alt="" />
    </a>
  );
}

const constellationTextSlide: TextSlide = {
  bullets: [
    {
      content: (
        <>
          this constellation evokes in my mind a particular <strong>scene</strong> from a movie
        </>
      ),
      id: "scene-evocation",
    },
    {
      content: (
        <>
          that constellation might <strong>save your life</strong>
        </>
      ),
      id: "life-saving-constellation",
    },
  ],
  kind: "text",
};

const firstGameTextSlide: TextSlide = {
  bullets: [
    {
      content: (
        <>
          the winner of this first game is the one who names that <strong>scene</strong>
        </>
      ),
      id: "winner-names-scene",
    },
    {
      content: (
        <>
          this tool referencing a particular <strong>different</strong> movie will help
        </>
      ),
      id: "different-movie-tool",
    },
    {
      content: (
        <>
          <strong>name movies or movie people</strong> as they come to your mind
        </>
      ),
      id: "name-movies-or-people",
    },
  ],
  kind: "text",
};

function getIntroStackItems(showRemainingContent: boolean): StackItem[] {
  return [
    { content: constellationTextSlide, id: "constellation-text" },
    { content: { kind: "image", src: constellationSrc }, id: "constellation-image" },
    { content: firstGameTextSlide, id: "first-game-text", isHidden: !showRemainingContent },
    {
      content: { kind: "link", href: "/?slideshow#film|Fast+Break+(1979)", src: fastBreakSrc },
      id: "fast-break-link",
      isHidden: !showRemainingContent,
    },
  ];
}

const slides: Slide[] = [
  {
    items: getIntroStackItems(false),
    kind: "stack",
  },
  {
    items: getIntroStackItems(true),
    kind: "stack",
  },
  { kind: "image", src: greatnanaSrc },
  { kind: "image", src: poseSrc },
  { kind: "image", src: poseConstellationSrc },
  { kind: "image", src: boxesSrc },
  { kind: "image", src: infographicSrc },
  { kind: "image", src: lifeSavingGameScreenshotSrc },
  { kind: "image", src: overlayStartSrc },
  { kind: "image", src: overlayEndSrc },
];

export default function YSlideshow() {
  const [slideIndex, setSlideIndex] = useState(0);

  const goBack = useCallback(() => {
    setSlideIndex((index) => Math.max(0, index - 1));
  }, []);

  const goForward = useCallback(() => {
    setSlideIndex((index) => Math.min(slides.length - 1, index + 1));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goForward();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [goBack, goForward]);

  const slide = slides[slideIndex];
  const isFirstSlide = slideIndex === 0;
  const isLastSlide = slideIndex === slides.length - 1;

  return (
    <main className="y-slideshow">
      <button
        aria-label="Previous slide"
        className="y-slideshow__nav y-slideshow__nav--prev"
        disabled={isFirstSlide}
        onClick={goBack}
        type="button"
      >
        ‹
      </button>

      <div className="y-slideshow__stage">
        {slide.kind === "stack" ? (
          <section className="y-slideshow__stack-slide">
            {slide.items.map((stackItem) => {
              const item = stackItem.content;
              const stackItemClassName = `y-slideshow__stack-item${stackItem.isHidden ? " y-slideshow__stack-item--hidden" : ""}`;

              return item.kind === "text" ? (
                renderTextSlide(
                  item,
                  `y-slideshow__text-slide y-slideshow__text-slide--stack ${stackItemClassName} y-slideshow__stack-item--text`,
                  stackItem.id,
                  Boolean(stackItem.isHidden),
                )
              ) : (
                <div
                  aria-hidden={stackItem.isHidden || undefined}
                  className={`${stackItemClassName} y-slideshow__stack-item--media`}
                  key={stackItem.id}
                >
                  {renderMediaSlide(item, "y-slideshow__stack-media-asset")}
                </div>
              );
            })}
          </section>
        ) : slide.kind === "text" ? (
          renderTextSlide(slide)
        ) : (
          renderMediaSlide(slide)
        )}
      </div>

      <button
        aria-label="Next slide"
        className="y-slideshow__nav y-slideshow__nav--next"
        disabled={isLastSlide}
        onClick={goForward}
        type="button"
      >
        ›
      </button>
    </main>
  );
}
