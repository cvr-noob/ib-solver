# ⚡ InterviewBit AI Solver

A powerful browser extension that automatically solves coding problems on InterviewBit using advanced AI models. It directly reads the problem, generates the Python solution, and types it into the editor for you!

> **⚠️ Important Limitations:**
> - **Browsers Supported:** Chromium-based browsers only (Google Chrome, Brave, Edge, etc.).
> - **Language Output:** Currently provides solutions in **Python** only.
> - **Problem Type:** Works *only* for coding problems. It does not work for Multiple Choice Questions (MCQs).

---

## 🛠️ Prerequisites

Before installing the extension, you need an API key from Groq:
1. Go to [Groq Console](https://console.groq.com/keys) and create a free account.
2. Generate a new API key.
3. **Copy and SAVE the key** somewhere safe (you will not be able to view it again once you close the window).

---

## 🚀 Installation

1. **Download the Extension:**
   - Go to the GitHub repository: [cvr-noob/ib-solver](https://github.com/cvr-noob/ib-solver).
   - Click on the green **Code** button at the top right.
   - Select **Download ZIP** from the dropdown menu.
   - Extract the downloaded ZIP file to a folder on your computer.
2. **Open Extensions Page:** Open your browser and navigate to `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. **Enable Developer Mode:** Toggle on **Developer mode** at the top right of the page.
4. **Load the Extension:** Click the **Load unpacked** button and select the folder you extracted in Step 1.

---

## ⚙️ Configuration

Once installed, you need to configure the extension with your API key and preferred AI models:

1. Pin the extension to your toolbar and click on its icon to open the popup.
2. Paste your **Groq API Key** in the required field.
3. Keep the **Primary Model** as `openai/gpt-oss-120b`.
4. Keep the **Fallback Model** as `groq/compound`. (This is automatically used if the primary model fails).
5. Click **Save Settings**.

---

## 💡 How to Use

1. Open any **coding problem** on [InterviewBit](https://www.interviewbit.com/).
2. You will notice a small **⚡ button** in the bottom right corner of the page.
3. Click the button to open the solver panel, then click **Solve with AI**.
4. The extension will automatically analyze the problem, generate a solution, and type it into the code editor.
5. *(Optional)* You can toggle **Auto-submit** ON in the extension popup or the solver panel to automatically submit the solution right after it finishes typing.
