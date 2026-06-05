import { useCallback, useEffect, useState } from "react";
import greatnanaSrc from "../assets/y/greatnana.avif";
import shape0Src from "../assets/y/shape_0.png";
import shape1Src from "../assets/y/shape_1.png";
import shape2Src from "../assets/y/shape_2.png";
import shape3Src from "../assets/y/shape_3.png";
import shape4Src from "../assets/y/shape_4.png";
import shape5Src from "../assets/y/shape_5.png";
import shape6Src from "../assets/y/shape_6.png";
import "./y_slideshow.css";

type ImageSlide = {
  kind: "image";
  src: string;
};

type LinkSlide = {
  href: string;
  kind: "link";
};

type Slide = ImageSlide | LinkSlide;

const slides: Slide[] = [
  { kind: "image", src: shape0Src },
  { kind: "link", href: "/#film|Fast+Break+(1979)" },
  { kind: "image", src: greatnanaSrc },
  { kind: "image", src: shape1Src },
  { kind: "image", src: shape2Src },
  { kind: "image", src: shape3Src },
  { kind: "image", src: shape4Src },
  { kind: "image", src: shape5Src },
  { kind: "image", src: shape6Src },
];

export default function YSlideshow() {
  const [slideIndex, setSlideIndex] = useState(0);

  const goBack = useCallback(() => {
    setSlideIndex((index) => (index + slides.length - 1) % slides.length);
  }, []);

  const goForward = useCallback(() => {
    setSlideIndex((index) => (index + 1) % slides.length);
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

  return (
    <main className="y-slideshow">
      <button
        aria-label="Previous slide"
        className="y-slideshow__nav y-slideshow__nav--prev"
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
          />
        )}
      </div>

      <button
        aria-label="Next slide"
        className="y-slideshow__nav y-slideshow__nav--next"
        onClick={goForward}
        type="button"
      >
        ›
      </button>
    </main>
  );
}
