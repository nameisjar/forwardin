/* eslint-disable @typescript-eslint/no-explicit-any */
export function processButton(buttons: any[]) {
    const preparedButtons: {
        quickReplyButton?: { displayText: any };
        callButton?: { displayText: any; phoneNumber: any };
        urlButton?: { displayText: any; url: any };
    }[] = [];

    buttons.map((button) => {
        if (button.type == 'replyButton') {
            preparedButtons.push({
                quickReplyButton: {
                    displayText: button.title ?? '',
                },
            });
        }

        if (button.type == 'callButton') {
            preparedButtons.push({
                callButton: {
                    displayText: button.title ?? '',
                    phoneNumber: button.payload ?? '',
                },
            });
        }
        if (button.type == 'urlButton') {
            preparedButtons.push({
                urlButton: {
                    displayText: button.title ?? '',
                    url: button.payload ?? '',
                },
            });
        }
    });
    return preparedButtons;
}
