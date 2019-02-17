const React = require("react");
const { useState, useEffect } = React;
const ReactDOM = require("react-dom");
const { act } = require("react-dom/test-utils");

// please see README.md for explanations

describe("act and jest, sitting in a tree", () => {
  it("can flush effects", () => {
    function App() {
      let [ctr, setCtr] = useState(0);
      useEffect(() => {
        setCtr(1);
      }, []);
      return ctr;
    }

    const el = document.createElement("div");

    act(() => {
      ReactDOM.render(<App />, el);
    });

    expect(el.innerHTML).toBe("1");
  });

  it("can handle multiple events", () => {
    function App() {
      let [ctr, setCtr] = useState(0);
      return <button onClick={() => setCtr(x => x + 1)}>{ctr}</button>;
    }

    const el = document.createElement("div");
    // we attach the element to body to ensure events work
    document.body.appendChild(el);
    ReactDOM.render(<App />, el);

    const button = el.childNodes[0];

    act(() => {
      for (let i = 0; i < 3; i++) {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    });

    expect(button.innerHTML).toBe("3");
  });

  describe("fake timers", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("can handle timers", () => {
      function App() {
        const [ctr, setCtr] = useState(0);
        useEffect(() => {
          setTimeout(() => setCtr(1), 1000);
        }, []);
        return ctr;
      }

      const el = document.createElement("div");
      act(() => {
        ReactDOM.render(<App />, el);
      });

      expect(el.innerHTML).toBe("0");

      act(() => {
        jest.runAllTimers();
      });

      expect(el.innerHTML).toBe("1");
    });

    it("can handle promises", () => {
      let resolve;
      function fetch() {
        return {
          then(fn) {
            resolve = fn;
          }
        };
      }

      function App() {
        let [data, setData] = useState(null);
        useEffect(() => {
          fetch("/some/url").then(setData);
        }, []);
        return data;
      }

      const el = document.createElement("div");
      act(() => {
        ReactDOM.render(<App />, el);
      });

      expect(el.innerHTML).toBe("");
      act(() => {
        resolve(42);
      });
      expect(el.innerHTML).toBe("42");
    });

    it("can handle async/await", () => {
      // this is the only test that requires the fancy babel setup
      global.Promise = require("promise");
      let resolve;
      function fetch() {
        return new Promise(_resolve => {
          resolve = _resolve;
        });
      }

      function App() {
        let [data, setData] = useState(null);
        async function somethingAsync() {
          let response = await fetch("/some/url");
          setData(response);
        }
        useEffect(() => {
          somethingAsync();
        }, []);
        return data;
      }

      const el = document.createElement("div");
      act(() => {
        ReactDOM.render(<App />, el);
      });

      expect(el.innerHTML).toBe("");

      act(() => {
        resolve(42);
        jest.runAllTimers();
      });

      expect(el.innerHTML).toBe("42");
    });
  });
});
