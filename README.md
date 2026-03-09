# RMagine Master - Local Setup Guide

This guide explains how to run the RMagine Master application on your local machine using your own API keys.

## Prerequisites

- [Node.js](https://nodejs.org/) (Version 18 or higher recommended)
- A Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Installation Steps

1. **Download the Code**
   Download or clone this repository to a folder on your computer.

2. **Install Dependencies**
   Open your terminal (Command Prompt, PowerShell, or Terminal) in the project folder and run:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   - Find the file named `.env.example` in the root folder.
   - Rename it to `.env`.
   - Open the `.env` file in a text editor.
   - Replace `your_actual_api_key_here` with your real Gemini API key:
     ```env
     GEMINI_API_KEY=AIzaSy...your_key_here...
     ```

4. **Start the Application**
   Run the following command to start the development server:
   ```bash
   npm run dev
   ```
   The terminal will provide a link (usually `http://localhost:3000`). Open that link in your browser.

## Project Structure

- `App.tsx`: Main application logic and UI.
- `services/geminiService.ts`: Handles all AI interactions (Scripts, Images, Voiceover).
- `components/`: UI components for the Player and Timeline.
- `vite.config.ts`: Configuration for the build system and environment variables.

## Troubleshooting

- **API Key Errors**: Ensure your `.env` file is named correctly (no `.txt` extension) and that your key is active in Google AI Studio.
- **Missing Modules**: If you see "module not found" errors, try running `npm install` again.
