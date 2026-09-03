# Real-browser test: L3 post-run self-review closed loop
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

        # fresh graph with goal via __wf
        page.evaluate("window.__wf.loadFlow({id:null,name:'',nodes:[],edges:[]})")
        page.wait_for_timeout(200)
        page.evaluate("window.__wf.setGoal('写一份产品需求文档')")
        page.wait_for_timeout(200)

        print("== 1. build draft (draft -> apply all) ==")
        page.evaluate("window.__wf.openDraft()")
        page.wait_for_timeout(1000)
        page.evaluate("window.__wf.draftSetAll(true)")
        page.evaluate("window.__wf.applyDraft()")
        page.wait_for_timeout(400)
        print("  nodes:", len(page.evaluate("window.__wf.getNodes()")))

        print("== 2. run the flow (triggers L3 self-review) ==")
        # stub: run through edges.js window.__wfRun path (click run) -- but that has 650ms/step animation
        # Instead call runSelfReview directly with fabricated results to check UI wiring.
        import json
        fabricated = {}
        for n in page.evaluate("window.__wf.getNodes()"):
            fabricated[n['id']] = {'status': 'done', 'score': 0.6, 'summary': 'x'}
        page.evaluate("window.__wf.runSelfReview(" + json.dumps(fabricated) + ", {})")
        page.wait_for_timeout(800)
        print("  review-bar visible:", page.locator("#review-bar:not(.hidden)").count() > 0)
        print("  apply button visible:", page.locator("#review-apply:not(.hidden)").count() > 0)
        txt = page.locator("#review-text").text_content()
        print("  review text present:", bool(txt and txt.strip()))

        print("== 3. click apply suggestion -> opens tweak preview ==")
        page.click("#review-apply")
        page.wait_for_timeout(1000)
        print("  draft overlay visible:", page.locator("#draft-overlay:not(.hidden)").count() > 0)
        print("  overlay title:", page.locator("#draft-title").text_content())
        # close
        page.evaluate("window.__wf.closeDraft()")
        page.wait_for_timeout(200)

        print("== 4. hide review bar works ==")
        page.evaluate("window.__wf.runSelfReview(" + json.dumps(fabricated) + ", {})")
        page.wait_for_timeout(500)
        page.click("#review-close")
        page.wait_for_timeout(200)
        print("  review-bar hidden:", page.locator("#review-bar.hidden").count() > 0)

        print("== 5. JS errors ==")
        print("  ", errors if errors else "none")
        browser.close()


if __name__ == "__main__":
    main()
