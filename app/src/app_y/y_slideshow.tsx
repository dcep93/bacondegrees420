import { useCallback, useEffect, useState } from "react";
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

type TextSlide = {
  bullets?: string[];
  kind: "text";
  text?: string;
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

type Slide = ImageSlide | LinkSlide | TextSlide;

const slides: Slide[] = [
  {
    kind: "text",
    text: "this constellation evokes a particular movie in my mind, and also, that pattern might save your life",
  },
  { kind: "image", src: constellationSrc },
  {
    bullets: [
      "the winner of this game is the one who names that movie",
      "this URL referencing a particular different movie will help us discover that secret movie, which is contained in a particular set",
      "name movies or movie people as they come to your mind, and this tool will reveal whether or not it is within that set",
    ],
    kind: "text",
  },
  { kind: "link", href: "/#film|Fast+Break+(1979)", src: fastBreakSrc },
  {
    kind: "text",
    text: "at this point, you have guessed the movie, but have you found an example of a movie not within the referenced set? (this is a fun feature of bacondegrees420)",
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
        {slide.kind === "image" ? (
          <img className="y-slideshow__image" src={slide.src} alt="" />
        ) : slide.kind === "link" ? (
          <a
            aria-label="Open Fast Break (1979)"
            className="y-slideshow__link-slide"
            href={slide.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <img className="y-slideshow__poster" src={slide.src} alt="" />
          </a>
        ) : (
          <section className="y-slideshow__text-slide">
            {slide.text ? <p>{slide.text}</p> : null}
            {slide.bullets ? (
              <ul>
                {slide.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
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
