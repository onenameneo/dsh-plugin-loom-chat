import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ImageGallery } from '../MessageImage.js'
import { messageImageLabels } from './labels.js'

/** Historical message-image slot entry. */
export function MessageImages({ images, loadImage, align, t }: MessageImagesProps) {
  return <ImageGallery images={images} load={loadImage} align={align} labels={messageImageLabels(t)} />
}
