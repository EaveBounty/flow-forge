# Real-browser end-to-end interaction test for dsh-workflow-studio frontend
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

        print("title:", page.title())
        print("rail buttons:", page.locator(".rail-btn").count())

        # 1. click Action menu button -> drawer opens
        page.click(".rail-btn--action")
        page.wait_for_timeout(400)
        print("drawer class:", page.locator("#drawer").get_attribute("class"))

        # 2. add an action node via __wf (simulates drop) -> triggers candidate generation
        has_wf = page.evaluate("typeof window.__wf")
        print("__wf present:", has_wf)
        page.evaluate("window.__wf.addNode('action', {title:'执行任务', description:'', prompt:'', recommended:false}, 150, 200)")
        page.wait_for_timeout(1800)
        print("picker visible:", page.locator("#picker-overlay:not(.hidden)").count() > 0)
        print("candidate count:", page.locator("#picker-list > *").count())

        # 3. select first candidate
        if page.locator("#picker-list > *").count() > 0:
            page.locator("#picker-list > *").first.click()
            page.wait_for_timeout(500)
            nodes = page.evaluate("window.__wf.getNodes().length")
            print("nodes after select:", nodes)
            n = page.evaluate("window.__wf.getNodes()[0]")
            print("node title:", n.get("title"), "| prompt len:", len(n.get("prompt") or ""))

        # 4. add a review node, connect action->review, check edge semantic
        page.evaluate("window.__wf.addNode('review', {title:'审核', description:'', prompt:'', recommended:false}, 400, 200)")
        page.wait_for_timeout(1800)
        if page.locator("#picker-list > *").count() > 0:
            page.locator("#picker-list > *").first.click()
            page.wait_for_timeout(400)
        print("nodes now:", page.evaluate("window.__wf.getNodes().length"))
        nodes_list = page.evaluate("window.__wf.getNodes()")
        id0 = nodes_list[0]["id"]
        id1 = nodes_list[1]["id"]

        # 5. connect node0 -> node1, wait for edge semantic, check edge label
        page.evaluate("window.__wf.addEdge('" + id0 + "', '" + id1 + "')")
        page.wait_for_timeout(1500)
        edges = page.evaluate("window.__wf.getEdges()")
        print("edges count:", len(edges))
        if edges:
            e = edges[0]
            data = e.get("data") or {}
            print("edge intent:", data.get("intent"), "| label:", data.get("label"))
            print("edge has description:", bool(data.get("description")), "| injection:", bool(data.get("injection")))
            print("edge label visible on canvas:", page.locator('#edge-labels').inner_text() != "")

        # 6. click run button -> should execute without error
        page.click("#btn-run")
        page.wait_for_timeout(3000)
        print("run completed (no throw), node run states:", page.evaluate(
            "window.__wf.getNodes().map(n => n.run ? n.run.status : 'none')"))

        print("JS errors:", errors if errors else "none")
        browser.close()


if __name__ == "__main__":
    main()
