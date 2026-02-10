import os
import asyncio
import requests
import json
import time
from contextlib import asynccontextmanager
from urllib.parse import urlparse
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, NonNegativeInt, HttpUrl, model_validator
from pydantic_core import PydanticCustomError
from typing import List, Optional

from dotenv import load_dotenv
from patchright.async_api import async_playwright, Browser, BrowserContext, Route, Request as PlaywrightRequest
from fake_useragent import UserAgent

import markdownify
from html_sanitizer import Sanitizer

sanitizer = Sanitizer()  # default configuration

# Load environment variables
load_dotenv()

# Configuration from environment
try:
    # Attempt to parse the environment variable as JSON
    DOMAIN_BLOCKED_DOMAINS = json.loads(os.getenv('DOMAIN_BLOCKED_DOMAINS', '[]'))
except Exception:
    DOMAIN_BLOCKED_DOMAINS = []

# https://playwright.dev/python/docs/api/class-request#request-resource-type
try:
    # Attempt to parse the environment variable as JSON
    RESOURCES_BLOCKED = json.loads(os.getenv('RESOURCES_BLOCKED', '["image", "stylesheet", "media", "font", "other"]'))
except Exception:
    RESOURCES_BLOCKED = ['image', 'stylesheet', 'media', 'font', 'other']

DOMAIN_BLOCKLIST_URL = os.getenv('DOMAIN_BLOCKLIST_URL')
DOMAIN_BLOCKLIST_PATH = os.getenv('DOMAIN_BLOCKLIST_PATH')

PROXY_SERVER = os.getenv('PROXY_SERVER')
PROXY_USERNAME = os.getenv('PROXY_USERNAME')
PROXY_PASSWORD = os.getenv('PROXY_PASSWORD')

PERSISTENT_CONTEXT = os.getenv("PERSISTENT_CONTEXT", 'False').lower() in ('true', '1', 't')
PATH_CONTEXT = "/context"

REMOTE_CDP = os.getenv('REMOTE_CDP')

# Global browser and context instances
browser: Browser = None
context: BrowserContext = None

class FirecrawlScape(BaseModel):
    url: HttpUrl
    formats: list[str] = ["markdown"]
    onlyMainContent: bool = True
    includeTags: Optional[list[str]] = None
    excludeTags: Optional[list[str]] = None
    headers: Optional[dict] = None
    waitFor: NonNegativeInt = 0
    mobile: bool = False
    skipTlsVerification: bool = False
    timeout: NonNegativeInt = 30000
    jsonOptions: Optional[dict] = None
    actions: Optional[list[dict]] = None
    location: dict = {"country": "US", "languages": ""}
    removeBase64Images: bool = False
    blockAds: bool = True


class UrlModel(BaseModel):
    url: HttpUrl
    wait_after_load: Optional[NonNegativeInt] = 0
    timeout: Optional[NonNegativeInt] = 15000
    headers: Optional[dict] = None

class MultipleUrlModel(BaseModel):
    url: Optional[HttpUrl] = None
    urls: Optional[List[HttpUrl]] = None
    wait_after_load: Optional[NonNegativeInt] = 0
    timeout: Optional[NonNegativeInt] = 15000
    headers: Optional[dict] = None

    @model_validator(mode='after')
    def check_url_or_urls(self):
        url = self.url
        urls = self.urls        

        if url is None and urls is None:
            raise PydanticCustomError(
                'url_or_urls_required',
                'Either "url" or "urls" must be provided',
            )
        if url is not None and urls is not None:
            raise PydanticCustomError(
                'url_or_urls_exclusive',
                'Only one of "url" or "urls" should be provided, not both',
            )

        return self

def get_error(status_code: int) -> Optional[str]:
    """Return error message for HTTP error status codes, None for success codes."""
    if 400 <= status_code < 500:
        return "Client error"
    elif 500 <= status_code < 600:
        return "Server error"
    return None


def update_ads_blocklist_from_url():
    try:
        # Download the blocklist
        response = requests.get(DOMAIN_BLOCKLIST_URL)
        response.raise_for_status()  # Raise an exception for HTTP errors

        # Split the content by lines and add each line to the list
        to_block = response.text.splitlines()

        # Split the content by lines and filter out lines starting with #
        to_block = [
            line.strip() for line in response.text.splitlines()
            if line.strip() and not line.strip().startswith("#")
        ]
        global DOMAIN_BLOCKED_DOMAINS
        DOMAIN_BLOCKED_DOMAINS.extend(to_block)

        print(f"Blocklist: {DOMAIN_BLOCKLIST_URL} downloaded. {len(DOMAIN_BLOCKED_DOMAINS)} domains blocked.")

    except requests.exceptions.RequestException as e:
        print(f"Error downloading the blocklist: {e}")

def update_ads_blocklist_from_file():
    try:
    # Open the file and read its contents
        with open(DOMAIN_BLOCKLIST_PATH, "r") as file:
            # Read all lines and filter out lines starting with #
            to_block = [
                line.strip() for line in file.readlines()
                if line.strip() and not line.strip().startswith("#")
            ]
        
        global DOMAIN_BLOCKED_DOMAINS
        DOMAIN_BLOCKED_DOMAINS.extend(to_block)

        print(f"Blocklist: {DOMAIN_BLOCKLIST_PATH} loaded. {len(DOMAIN_BLOCKED_DOMAINS)} domains blocked.")
    except FileNotFoundError:
        print(f"Error: The file '{DOMAIN_BLOCKLIST_PATH}' was not found.")
    except Exception as e:
        print(f"An error occurred while reading the file: {e}")
    

@asynccontextmanager
async def lifespan(app: FastAPI):
    global browser, context, RESOURCES_BLOCKED, DOMAIN_BLOCKED_DOMAINS

    user_agent = UserAgent(browsers=['Chrome']).random

    viewport = {'width': 1920, 'height': 1080}
    context_options = {'user_agent': user_agent, 'viewport': viewport}

    if PROXY_SERVER:
        print(f"Using proxy server {PROXY_SERVER}")
        context_options['proxy'] = {
            'server': PROXY_SERVER,
            **({'username': PROXY_USERNAME, 'password': PROXY_PASSWORD} 
               if PROXY_USERNAME and PROXY_PASSWORD else {})
        }
    else:
        print("⚠️ WARNING: No proxy server provided")

    # Startup logic
    playwright = await async_playwright().start()
    
    if REMOTE_CDP:
        print(f"Launching Chrome with remote connection to {REMOTE_CDP}")
        browser = await playwright.chromium.connect_over_cdp(f"wss://{REMOTE_CDP}")
        context = browser.contexts[0]
    else:
        if PERSISTENT_CONTEXT:
            print("Launching Chrome with persistent context.")
            context = await playwright.chromium.launch_persistent_context(
                user_data_dir=PATH_CONTEXT,
                headless=True,
                channel="chrome",
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--no-default-browser-check',
                    '--disable-infobars'
                ],
                **context_options
            )
        else:
            print("Launching Chrome with temporary context.")
            browser = await playwright.chromium.launch(
                headless=True,
                channel="chrome",
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--no-default-browser-check',
                    '--no-startup-window',
                    '--disable-infobars'
                ]
            )
            context = await browser.new_context(**context_options)
    

    if RESOURCES_BLOCKED:
        print(f"Resources: {RESOURCES_BLOCKED} are blocked")
    else:
        print("Resource blocking is disabled.")
    
    if DOMAIN_BLOCKLIST_PATH:
        update_ads_blocklist_from_file()
    if DOMAIN_BLOCKLIST_URL:
        update_ads_blocklist_from_url()
    if DOMAIN_BLOCKED_DOMAINS:
        DOMAIN_BLOCKED_DOMAINS=list(set(DOMAIN_BLOCKED_DOMAINS)) # remove duplicates
        print(f"{len(DOMAIN_BLOCKED_DOMAINS)} domains blocked.")
    else:
        print("Domain blocking is disabled.")


    async def block_elements(route: Route, request: PlaywrightRequest):
        hostname = urlparse(request.url).hostname
        if hostname in DOMAIN_BLOCKED_DOMAINS or request.resource_type in RESOURCES_BLOCKED:
            await route.abort()
        else:
            await route.continue_()

    await context.route("**/*", block_elements)

    print("Ready!")

    yield  # App is running

    # Shutdown logic
    print("Shutting down")

    if context:
        await context.close()
    if browser:
        await browser.close()

   

app = FastAPI(lifespan=lifespan,
    title="Patchright scraping API",
   # description=description,
    summary="API to scrape an url using patchright",
    version="0.1.1",
    contact={
        "name": "loorisr",
        "url": "https://github.com/loorisr/patchright-scrape-api"
    },
    license_info={
        "name": "GNU Affero General Public License v3.0",
        "url": "https://www.gnu.org/licenses/agpl-3.0.en.html",
    })

# Firecrawl compatible scrape API
@app.post("/v1/scrape")
async def scrape_single_firecrawl(request_model: FirecrawlScape):
    request_model_scrape = UrlModel(
            url=request_model.url,
            wait_after_load=request_model.waitFor,
            timeout=request_model.timeout,
            headers=request_model.headers if request_model.headers else {}  # Use {} if None
        )
    
    scrapped_result =  await scrape_page(request_model_scrape)
    rawHtml = scrapped_result['content']
    result = {}
    result['success'] = True
    result['data'] = {}
    result['metadata'] = {}
    result['metadata']['url'] = request_model.url
    result['metadata']['statusCode'] = scrapped_result['pageStatusCode']
    result['metadata']['processingTime'] = scrapped_result['processingTime']
    
    if 'markdown' in request_model.formats:
        markdown = markdownify.markdownify(rawHtml)
        result['data']['markdown'] = markdown

    if 'rawHtml' in request_model.formats:
        result['data']['rawHtml'] = rawHtml

    if 'html' in request_model.formats:
        html = sanitizer.sanitize(rawHtml)
        result['data']['html'] = html

    return result


@app.post("/scrape")
async def scrape_page_endpoint(request_model: MultipleUrlModel):
    if request_model.url: # single url
        scrape_query = UrlModel(
            url=request_model.url,
            wait_after_load=request_model.wait_after_load,
            timeout=request_model.timeout,
            headers=request_model.headers if request_model.headers else {}  # Use {} if None
            ) 
        return await scrape_page(scrape_query)

    if request_model.urls: # multiple urls
        urls = request_model.urls

        url_models = [
            UrlModel(
                url=url_item,
                wait_after_load=request_model.wait_after_load,
                timeout=request_model.timeout,
                headers=request_model.headers if request_model.headers else {}  # Use {} if None
            ) for url_item in urls
        ]

        results = await asyncio.gather(
            *(scrape_page(url_model) for url_model in url_models)
        )
        return results



async def scrape_page(request_model: UrlModel):
    startTime = time.time()
    url = str(request_model.url)

    print(f"\n{'='*20} Scrape Request {'='*20}")
    print(f"URL: {url}")
    print(f"Wait After Load: {request_model.wait_after_load}ms")
    print(f"Timeout: {request_model.timeout}ms")
    print(f"Headers: {request_model.headers or 'None'}")
    print('='*50)

    page = await context.new_page()
    try:
        if request_model.headers:
            await page.set_extra_http_headers(request_model.headers)

        # Strategy 1: Load event
        try:
            print("Attempting strategy 1: Normal load")
            response = await page.goto(
                url, 
                wait_until="load",
                timeout=request_model.timeout
            )
        except Exception as e:
            print(f"Strategy 1 failed: {str(e)}")
            # Strategy 2: Network idle
            print("Attempting strategy 2: Network idle")
            response = await page.goto(
                url,
                wait_until="networkidle",
                timeout=request_model.timeout
            )

        if request_model.wait_after_load > 0:
            await page.wait_for_timeout(request_model.wait_after_load)

        content = await page.content()
        header_content_type = await response.header_value('Content-Type')
        if (header_content_type and ("application/json" in header_content_type.lower() or "text/plain" in header_content_type.lower())):
            body_bytes = await response.body()
            content = body_bytes.decode('utf-8', errors='replace')
        
        status_code = response.status if response else None
        page_error = get_error(status_code) if status_code != 200 else None

        endTime = time.time()

        if not page_error:
            print(f"✅ {url} scrape successful in {endTime-startTime:.3f}s!")
        else:
            print(f"🚨 {url} scrape failed with status code: ${page_error}")
                        
        return {
            "content": content,
            "pageStatusCode": status_code,
            "processingTime": round(endTime-startTime, 3),
            **({"pageError": page_error} if page_error else {})
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        await page.close()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(f"{__name__}:app", host="0.0.0.0", port=int(os.getenv('PORT', 3000)))