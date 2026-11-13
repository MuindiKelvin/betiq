// Ownership credit shown on every screen
export default function Credit({ className = "" }) {
  return (
    <div className={"credit " + className}>
      &copy; {new Date().getFullYear()} BetIQ. All rights reserved. Developed by:{" "}
      <a href="https://muindikelvin.github.io" target="_blank" rel="noopener noreferrer">muindikelvin.github.io</a>
    </div>
  );
}
