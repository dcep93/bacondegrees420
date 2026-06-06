import { useCallback, useEffect, useState } from "react";
import fastBreakSrc from "../assets/y/fast_break.jpg";
import greatnanaSrc from "../assets/y/greatnana.avif";
import shape0Src from "../assets/y/shape_0.png";
import shape1Src from "../assets/y/shape_1.png";
import shape2Src from "../assets/y/shape_2.png";
import shape3Src from "../assets/y/shape_3.png";
import shape4Src from "../assets/y/shape_4.png";
import "./y_slideshow.css";

type ImageSlide = {
  kind: "image";
  src: string;
};

type LinkSlide = {
  href: string;
  kind: "link";
  src: string;
};

type Slide = ImageSlide | LinkSlide;

const slides: Slide[] = [
  { kind: "image", src: shape0Src },
  { kind: "link", href: "/#film|Fast+Break+(1979)", src: fastBreakSrc },
  { kind: "image", src: greatnanaSrc },
  { kind: "image", src: shape1Src },
  { kind: "image", src: shape2Src },
  { kind: "image", src: shape3Src },
  { kind: "image", src: shape4Src },
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
        ) : (
          <a
            aria-label="Open Fast Break (1979)"
            className="y-slideshow__link-slide"
            href={slide.href}
            rel="noopener noreferrer"
            target="_blank"
          >
            <img className="y-slideshow__poster" src={slide.src} alt="" />
          </a>
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
