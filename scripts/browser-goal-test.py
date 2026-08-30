# Real-browser test: goal-gate + AI-generation confirmation
from playwright.sync_api import sync_playwright

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
BASE = "http://127.0.0.1:8010/"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROME)
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE)
        page.wait_for_timeout(1500)

        print("== 1. auto root on empty canvas ==")
        nodes = page.evaluate("window.__wf.getNodes()")
        roots = [n for n in nodes if n["kind"] == "root"]
        print("  total nodes:", len(nodes), "| roots:", len(roots))
        print("  root goal field rendered:", page.locator(".wf-goal-input").count() > 0)
        print("  root goal hint shown:", page.locator(".wf-goal-hint").count() > 0)

        print("== 2. try add action BEFORE goal -> must be blocked ==")
        before = page.evaluate("window.__wf.getNodes().length")
        page.evaluate("window.__wf.addNode('action', {title:'执行',description:'',prompt:'',recommended:false}, 300, 300)")
        page.wait_for_timeout(300)
        after = page.evaluate("window.__wf.getNodes().length")
        print("  nodes before/after (should be equal):", before, "/", after)
        kinds = [n["kind"] for n in page.evaluate("window.__wf.getNodes()")]
        print("  kinds:", kinds)

        print("== 3. try create 2nd root -> must be blocked ==")
        before2 = page.evaluate("window.__wf.getNodes().length")
        page.evaluate("window.__wf.addNode('root', {title:'x'}, 500, 500)")
        page.wait_for_timeout(200)
        after2 = page.evaluate("window.__wf.getNodes().length")
        print("  nodes before/after (should be equal):", before2, "/", after2)

        print("== 4. set goal, then add action -> allowed ==")
        page.fill(".wf-goal-input", "写一份季度财报分析")
        page.dispatch_event(".wf-goal-input", "input")
        page.locator(".wf-goal-input").blur()
        page.wait_for_timeout(300)
        page.evaluate("window.__wf.addNode('action', {title:'执行',description:'',prompt:'',recommended:false}, 300, 300)")
        page.wait_for_timeout(2000)
        nodes_after = page.evaluate("window.__wf.getNodes()")
        print("  nodes now:", len(nodes_after), "| kinds:", [n["kind"] for n in nodes_after])
        print("  picker visible:", page.locator("#picker-overlay:not(.hidden)").count() > 0)
        print("  candidates:", page.locator("#picker-list > *").count())

        print("== 5. JS errors ==")
        print("  ", errors if errors else "none")
        browser.close()


if __name__ == "__main__":
    main()
