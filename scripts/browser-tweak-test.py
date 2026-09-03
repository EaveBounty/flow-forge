# Real-browser test: L2 speak-to-edit (intent -> graph diff preview -> apply)
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
        page.wait_for_timeout(1200)

        # fresh: clear to a single root + goal via __wf
        page.evaluate("window.__wf.loadFlow({id:null,name:'',nodes:[],edges:[]})")
        page.wait_for_timeout(200)
        # auto-root appears; set goal
        roots = page.evaluate("window.__wf.getNodes()")
        if not any(n['kind'] == 'root' for n in roots):
            page.evaluate("window.__wf.addNode('root',{title:'流程起点'},100,100)")
        page.wait_for_timeout(200)
        page.evaluate("window.__wf.setGoal('写一份产品需求文档')")
        page.wait_for_timeout(200)

        print("== 1. cmd-bar visible after goal ==")
        print("  cmd-bar visible:", page.locator("#cmd-bar:not(.hidden)").count() > 0)

        print("== 2. build a draft first (so graph exists), then tweak ==")
        page.evaluate("window.__wf.openDraft()")
        page.wait_for_timeout(1000)
        # keep all
        page.evaluate("window.__wf.draftSetAll(true)")
        page.evaluate("window.__wf.applyDraft()")
        page.wait_for_timeout(400)
        n0 = len(page.evaluate("window.__wf.getNodes()"))
        e0 = len(page.evaluate("window.__wf.getEdges()"))
        print("  base graph nodes/edges:", n0, "/", e0)

        print("== 3. submit intent: add review stage ==")
        page.fill("#cmd-input", "在动作后加一步审核把关")
        page.press("#cmd-input", "Enter")
        page.wait_for_timeout(1000)
        print("  overlay visible:", page.locator("#draft-overlay:not(.hidden)").count() > 0)
        title = page.locator("#draft-title").text_content()
        print("  overlay title:", title)
        items = page.locator("#draft-list .draft-item").count()
        print("  preview items:", items)

        print("== 4. apply tweak ==")
        page.evaluate("window.__wf.applyDraft()")
        page.wait_for_timeout(500)
        n1 = len(page.evaluate("window.__wf.getNodes()"))
        e1 = len(page.evaluate("window.__wf.getEdges()"))
        kinds = [n["kind"] for n in page.evaluate("window.__wf.getNodes()")]
        print("  after tweak nodes:", n1, "(was", n0, ") | kinds:", kinds)
        print("  review added:", kinds.count("review") >= 1)

        print("== 5. JS errors ==")
        print("  ", errors if errors else "none")
        browser.close()


if __name__ == "__main__":
    main()
